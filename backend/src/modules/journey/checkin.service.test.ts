import { describe, expect, it } from "vitest";
import { compactSnapshot, compareSnapshots, type CheckInSnapshot } from "./checkin.service";
const row=(key:string,date:string,hash=key)=>({key,date,hash,amount:1});
const snap=(date:string,rows:ReturnType<typeof row>[]):CheckInSnapshot=>({version:2,date,...compactSnapshot(rows,date),bankCash:100,coverageVersion:'v',incomplete:false});
describe('bounded weekly snapshots',()=>{
 it('caps stored detail and does not claim exact changes when truncated',()=>{
  const current=snap('2026-09-18',Array.from({length:1200},(_,i)=>row(String(i),'2026-09-01')));
  expect(current.rows).toHaveLength(1000);expect(current.truncated).toBe(true);
  expect(compareSnapshots(current,current)).toMatchObject({limited:true,added:null,removed:null});
 });
 it('does not count records aging out of the window as deleted',()=>{
  const before=snap('2026-09-30',[row('old','2026-07-01'),row('kept','2026-09-01')]);
  const after=snap('2026-10-01',[row('old','2026-07-01'),row('kept','2026-09-01')]);
  expect(compareSnapshots(before,after)).toMatchObject({removed:0,historyChanged:null});
 });
 it('distinguishes historical changes and recent late imports from this week',()=>{
  const before=snap('2026-09-11',[row('history','2025-01-01')]);
  const after=snap('2026-09-18',[row('history','2025-01-01','edited'),row('late','2026-08-01')]);
  expect(compareSnapshots(before,after)).toMatchObject({added:1,late:1,historyChanged:true});
 });
 it('starts a new baseline for legacy schemas and hides cash conclusions for incomplete coverage',()=>{
  const current=snap('2026-09-18',[]);
  expect(compareSnapshots({...current,version:1},current).baseline).toBe(true);
  expect(compareSnapshots({...current,incomplete:true},current).cashChange).toBeNull();
 });
});
