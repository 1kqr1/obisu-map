import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const script = readFileSync(new URL('../YamaguchiWidget.js', import.meta.url), 'utf8');
const realFeed = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));
const exported = 'return { japanParts, validateFeed, sourceURL, roadInfo, scheduleFor, nextRefresh, readFeed, makeWidget };';
async function helpers(overrides = {}) { return await vm.runInNewContext('(async()=>{' + script + '\n' + exported + '})()', { ...overrides }); }
function fixture(bands, day = '2026-10-13') {
  return { schema_version: 1, prefecture: '山口県', timezone: 'Asia/Tokyo', hp_coverage_dates: [day], days: {
    [day]: bands.map((band, n) => ({ id: String(n), title: '国道2号 / 岩国', road: '国道2号', police_stations: ['岩国'], kind: 'speed', time_band: band, source_url: 'https://www.pref.yamaguchi.lg.jp/site/police/1.html' })) } };
}
test('Japan date is independent of device timezone and changes at 15:00 UTC', async()=>{
  const h = await helpers();
  assert.equal(h.japanParts(new Date('2026-10-13T14:59:59Z')).day, '2026-10-13');
  assert.equal(h.japanParts(new Date('2026-10-13T15:00:00Z')).day, '2026-10-14');
});
test('Time windows use inclusive starts and exclusive ends with requested labels', async()=>{
  const h = await helpers(), feed = fixture(['day','night_early','unspecified']);
  for (const [time, expected] of [['05:59:59','before'],['06:00:00','within'],['18:00:00','ended']]) {
    assert.equal(h.scheduleFor(feed,new Date('2026-10-13T'+time+'+09:00')).rows.find(r=>r.item.id==='0').state,expected);
  }
  const s=h.scheduleFor(feed,new Date('2026-10-13T09:00:00+09:00'));
  assert.equal(s.summary,'🚨1 予定1 終0 告1');
  assert.deepEqual(Array.from(s.rows,r=>r.state),['within','before','unknown']);
});
test('Previous night early records stop at 06:00 and yesterday is never shown as today',async()=>{
  const h=await helpers(), feed=fixture(['early','day'],'2026-10-14');
  assert.equal(h.scheduleFor(feed,new Date('2026-10-14T05:59:59+09:00')).rows[0].state,'within');
  assert.equal(h.scheduleFor(feed,new Date('2026-10-14T06:00:00+09:00')).rows.find(r=>r.item.id==='0').state,'ended');
  const next=h.scheduleFor(feed,new Date('2026-10-15T00:00:00+09:00'));
  assert.equal(next.rows.length,0);assert.equal(next.covered,false);
});
test('Real shared feed has matching groups and sorts current windows first',async()=>{
  const h=await helpers();h.validateFeed(realFeed);
  const s=h.scheduleFor(realFeed,new Date('2026-10-13T20:00:00+09:00'));
  assert.equal(s.rows.length,8);assert.equal(s.counts.within,2);assert.equal(s.counts.ended,6);
  assert.equal(s.rows[0].badge,'191');
  assert.equal(s.rows[1].area,'宇部');
});
test('Untimed X notice is not treated as an ended or active enforcement',async()=>{
  const h=await helpers(), f=fixture(['day']);f.days['2026-10-13'][0].kind='mobile_orbis';
  assert.equal(h.scheduleFor(f,new Date('2026-10-13T09:00:00+09:00')).rows[0].state,'unknown');
  assert.equal(h.roadInfo({...f.days['2026-10-13'][0],kind:'speed',road:'国道その他'}).badge,'?');
});
test('Only official source URLs can open from a row',async()=>{
  const h=await helpers();
  assert.equal(h.sourceURL('https://x.com/YamaguchiPolice/status/123'),'https://x.com/YamaguchiPolice/status/123');
  for(const bad of ['https://x.com/OtherPolice/status/123','https://www.pref.yamaguchi.lg.jp@evil.test/site/police/1','http://www.pref.yamaguchi.lg.jp/site/police/1','https://www.pref.yamaguchi.lg.jp.evil.test/site/police/1']) assert.equal(h.sourceURL(bad),'https://orbis.1kqr1.com/');
});
test('Refresh requests do not skip the next Japan midnight or time window',async()=>{
  const h=await helpers();
  assert.equal(h.nextRefresh(new Date('2026-10-13T23:50:00+09:00')).toISOString(),'2026-10-13T15:00:00.000Z');
  assert.equal(h.nextRefresh(new Date('2026-10-13T05:50:00+09:00')).toISOString(),'2026-10-12T21:00:00.000Z');
});
function storageMocks(response, initial=null, fail=false) {
  const files=new Map(initial?[['/library/cache',JSON.stringify(initial)]]:[]);
  const fm={libraryDirectory:()=>'/library',joinPath:()=>'/library/cache',fileExists:path=>files.has(path),readString:path=>files.get(path),writeString:(path,value)=>files.set(path,value)};
  class Request { constructor(url){assert.equal(url,'https://orbis.1kqr1.com/data/widget_yamaguchi.json');} async loadString(){if(fail)throw Error('offline');this.response={statusCode:200};return JSON.stringify(response);} }
  return {files,FileManager:{local:()=>fm},Request};
}
test('Offline and invalid updates retain verified previous cache',async()=>{
  const f=fixture(['day']), cache={feed:f,checkedAt:'2026-10-13T00:00:00Z'};
  for(const mocks of [storageMocks(null,cache,true),storageMocks({schema_version:2},cache,false)]) {
    const h=await helpers(mocks), result=await h.readFeed();
    assert.equal(result.failed,true);assert.equal(result.feed.schema_version,1);
    assert.equal(JSON.parse(mocks.files.get('/library/cache')).checkedAt,cache.checkedAt);
  }
  const empty=await (await helpers(storageMocks(null,null,true))).readFeed();assert.equal(empty.feed,null);
});
test('Success validates and stores feed, corrupt cache does not block fetching',async()=>{
  const mocks=storageMocks(fixture(['day']));mocks.files.set('/library/cache','broken');
  const result=await (await helpers(mocks)).readFeed();
  assert.equal(result.failed,false);assert.equal(JSON.parse(mocks.files.get('/library/cache')).feed.schema_version,1);
});
class Stack {
  constructor(){this.children=[];}
  addText(value){const text={text:value,centerAlignText(){}};this.children.push(text);return text;}
  addStack(){const child=new Stack();this.children.push(child);return child;}
  addSpacer(){} layoutHorizontally(){} layoutVertically(){} centerAlignContent(){} setPadding(){}
}
class ListWidget extends Stack {}
class Color { constructor(hex){this.hex=hex;}static dynamic(light,dark){return {light,dark};}static white(){return new Color('FFFFFF');} }
class Size { constructor(width,height){this.width=width;this.height=height;} }
const Font={boldSystemFont:n=>n,systemFont:n=>n,regularMonospacedSystemFont:n=>n};
function flatten(node){return [node,...(node.children||[]).flatMap(flatten)];}
test('All widget sizes use official API, dynamic colors and bounded rows',async()=>{
  const h=await helpers({ListWidget,Color,Size,Font,URLScheme:{forRunningScript:()=> 'scriptable:///run?scriptName=widget'}});
  for(const [family,rows] of [['small',2],['medium',4],['large',8]]) {
    const widget=h.makeWidget({feed:realFeed,failed:false},new Date('2026-10-13T20:00:00+09:00'),family);
    assert.equal(flatten(widget).filter(n=>n.size?.height===44 && n.children?.some(c=>c.size?.width===3)).length,rows);
    assert.equal(widget.backgroundColor.dark.hex,'161B22');
    assert.equal(widget.backgroundColor.light.hex,'FFFFFF');
    assert(flatten(widget).some(n=>n.text==='🚨'));
    assert.equal(widget.url,'https://orbis.1kqr1.com/');
  }
});
