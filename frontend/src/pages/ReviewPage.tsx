import { Link } from "react-router-dom";
import { Card } from "../components/common/Card";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { useAsync } from "../hooks/useAsync";
import { getJourneyActions } from "../services/journey.service";
export default function ReviewPage(){const resource=useAsync(getJourneyActions,[]);return <Card title="מה דורש בדיקה"><AsyncSection resource={resource} errorTitle="לא ניתן לטעון פריטים לבדיקה" skeleton={<Loading/>}>{items=><>{items.length?<ul className="journey-list">{items.map(i=><li key={i.id}><Link to={`${i.to}${i.to.includes("?")?"&":"?"}returnTo=${encodeURIComponent("/review")}`}>{i.title}</Link><small>{i.reason}</small></li>)}</ul>:<p>אין פריטים שמחייבים טיפול במידע הרשום.</p>}<div className="row-actions"><Link to="/check-in">חזרה לבדיקה השבועית</Link><Link to="/data">עדכניות מקורות</Link></div></>}</AsyncSection></Card>;}
