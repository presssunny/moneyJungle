import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAsync } from "../../hooks/useAsync";
import { sharedGet } from "../../services/queryCache";
import type { FinancialMetric, MetricName } from "../../types/metric.types";
import { formatCurrency, formatDate } from "../../utils/format";
import { Button } from "./Button";
import { Loading } from "./Loading";

function MetricDetail({metric,month,version,card}:{card?:string;metric:MetricName;month?:string;version?:string}) {
 const [page,setPage]=useState(1);
 const [snapshot,setSnapshot]=useState(version);
 const resource=useAsync(async()=>{
   return sharedGet<FinancialMetric>(`/journey/metrics/${metric}`,{month,page,version:snapshot,card});
 },[metric,month,page,snapshot,card]);
 if(resource.error)return <div role="alert"><p>{resource.error}</p><Button onClick={()=>{setPage(1);setSnapshot(undefined);resource.reload();}}>רענון הפירוט</Button></div>;
 if(resource.loading||!resource.data)return <Loading/>;
 const data=resource.data;
 return <div>
  <p><strong>{data.value===null?'לא ידוע':formatCurrency(data.value)}</strong> · נכון ל־{formatDate(data.asOf)} · {formatDate(data.period.from)}–{formatDate(data.period.to)}</p>
  <p>{data.formula}</p><p className="text-muted">{data.coverage}</p>
  <ul>{data.assumptions.map(item=><li key={item}>{item}</li>)}{data.missingData.map(item=><li key={item}>{item}</li>)}</ul>
  <ul className="journey-list">{data.components.map(row=><li key={row.key}><Link to={row.to}>{row.label}{row.date&&` · ${formatDate(row.date)}`}</Link><span>{row.value===null?'סכום לא ידוע':formatCurrency(row.value)}{row.detail&&` · ${row.detail}`}</span></li>)}</ul>
  <p>{data.total} רכיבים · עמוד {data.page} מתוך {Math.max(1,Math.ceil(data.total/data.pageSize))}</p>
  {data.total>data.pageSize&&<div className="row-actions"><Button disabled={page===1} onClick={()=>{setSnapshot(data.dataVersion);setPage(page-1);}}>הקודם</Button><Button disabled={page*data.pageSize>=data.total} onClick={()=>{setSnapshot(data.dataVersion);setPage(page+1);}}>הבא</Button></div>}
  <p>{data.sources.map(source=><Link key={source.key} to={source.to}>{source.label} · </Link>)}</p>
 </div>;
}
export function MetricExplanation({title="איך חושב המספר?",children,metric,month,version,card}:{card?:string;title?:string;children?:ReactNode;metric?:MetricName;month?:string;version?:string}) {
 const [open,setOpen]=useState(false);
 return <details className="metric-explanation" onToggle={e=>setOpen(e.currentTarget.open)}><summary>{title}</summary><div>{children}{open&&metric&&<MetricDetail key={`${metric}:${month}:${version}:${card}`} metric={metric} month={month} version={version} card={card}/>}</div></details>;
}
