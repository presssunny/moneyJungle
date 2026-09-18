import { describe, expect, it } from "vitest";
import { rankActions, type JourneyAction } from "./actions.service";
const action = (id:string,topic:string,priority:number,to="/data"):JourneyAction => ({id,topic,priority,to,title:id,reason:"source evidence"});
describe("shared journey action ranking",()=>{
  it("deduplicates one topic across different routes",()=>{
    expect(rankActions([action("summary","credit:7",40,"/accounts"),action("session","credit:7",0,"/imports")]).map(a=>a.id)).toEqual(["session"]);
  });
  it("keeps different problems even when their destination is identical",()=>{
    expect(rankActions([action("a","bank:1",0),action("b","bank:2",0)])).toHaveLength(2);
  });
  it("orders blocked information, cash pressure and goal progress without filling empty slots",()=>{
    expect(rankActions([action("goal","goal:1",60),action("overdue","loan:1",15),action("coverage","coverage",10),action("review","session:1",0)]).map(a=>a.id)).toEqual(["review","coverage","overdue","goal"]);
    expect(rankActions([])).toEqual([]);
  });
});
