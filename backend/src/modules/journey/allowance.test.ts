import { describe, expect, it } from "vitest";
import { calculateAllowance } from "./allowance";
import { businessDate, nextDate } from "./journey.utils";
describe("commitment-aware daily planning",()=>{
 it("includes the last day instead of dividing by zero",()=>{expect(calculateAllowance(100,0,0,['2026-09-30'],[])).toEqual({daily:100,shortfall:0});});
 it("reserves a bill before spending the apparent monthly surplus",()=>{expect(calculateAllowance(1000,100,0,['2026-09-29','2026-09-30'],[{date:'2026-09-30',amount:600}]).daily).toBe(150);});
 it("does not let a later cash position conceal an earlier shortfall",()=>{expect(calculateAllowance(100,0,0,['2026-09-29','2026-09-30'],[{date:'2026-09-29',amount:150}])).toEqual({daily:0,shortfall:50});});
 it("reserves overdue unpaid obligations at the first cutoff",()=>{expect(calculateAllowance(100,0,0,['2026-09-30'],[{date:'2026-09-01',amount:60}]).daily).toBe(40);});
 it("protects variable essentials and floors to the agora",()=>{expect(calculateAllowance(100,0,10,['2026-09-28','2026-09-29','2026-09-30'],[]).daily).toBe(30);expect(calculateAllowance(100,0,0,['2026-09-28','2026-09-29','2026-09-30'],[]).daily).toBe(33.33);});
 it("uses Israel calendar dates around midnight and DST",()=>{expect(businessDate(new Date('2026-09-17T22:30:00Z'))).toBe('2026-09-18');expect(nextDate('2026-03-27',1)).toBe('2026-03-28');expect(nextDate('2028-02-28',1)).toBe('2028-02-29');});
});
