// Vercel serverless function: /api/lines
//
// Fetches upcoming NFL spreads from the-odds-api.com and returns them already
// formatted for the Post Lines paste box.
//
// The API key lives in a Vercel environment variable named ODDS_API_KEY, NOT
// in this file and NOT in index.html. index.html is public; anyone reading it
// could otherwise burn through the monthly quota.
//
// Quota note: cost is markets x regions. One market (spreads), one region (us)
// = 1 credit per call. The free tier is 500/month.

const ABBR = {
  "Arizona Cardinals":"ARI",      "Atlanta Falcons":"ATL",
  "Baltimore Ravens":"BAL",       "Buffalo Bills":"BUF",
  "Carolina Panthers":"CAR",      "Chicago Bears":"CHI",
  "Cincinnati Bengals":"CIN",     "Cleveland Browns":"CLE",
  "Dallas Cowboys":"DAL",         "Denver Broncos":"DEN",
  "Detroit Lions":"DET",          "Green Bay Packers":"GB",
  "Houston Texans":"HOU",         "Indianapolis Colts":"IND",
  "Jacksonville Jaguars":"JAX",   "Kansas City Chiefs":"KC",
  "Las Vegas Raiders":"LV",       "Los Angeles Chargers":"LAC",
  "Los Angeles Rams":"LAR",       "Miami Dolphins":"MIA",
  "Minnesota Vikings":"MIN",      "New England Patriots":"NE",
  "New Orleans Saints":"NO",      "New York Giants":"NYG",
  "New York Jets":"NYJ",          "Philadelphia Eagles":"PHI",
  "Pittsburgh Steelers":"PIT",    "San Francisco 49ers":"SF",
  "Seattle Seahawks":"SEA",       "Tampa Bay Buccaneers":"TB",
  "Tennessee Titans":"TEN",       "Washington Commanders":"WAS"
};

// Format a UTC instant as "9/13 1:00p" in Eastern time — the same shape the
// paste parser expects.
function etStamp(iso){
  const parts = new Intl.DateTimeFormat("en-US",{
    timeZone:"America/New_York", month:"numeric", day:"numeric",
    hour:"numeric", minute:"2-digit", hour12:true
  }).formatToParts(new Date(iso));
  const g = t => parts.find(p=>p.type===t).value;
  return `${g("month")}/${g("day")} ${g("hour")}:${g("minute")}${g("dayPeriod").toLowerCase()[0]}`;
}

export default async function handler(req, res){
  const key = process.env.ODDS_API_KEY;
  if(!key) return res.status(500).json({error:"ODDS_API_KEY is not set in Vercel."});

  const days = Math.min(Number(req.query.days) || 8, 21);
  const book = req.query.book || "draftkings";

  const url = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/"
    + `?apiKey=${key}&regions=us&markets=spreads&oddsFormat=american&bookmakers=${book}`;

  try{
    const r = await fetch(url);
    if(!r.ok){
      const body = await r.text();
      return res.status(r.status).json({error:`Odds API ${r.status}`, detail:body.slice(0,300)});
    }
    const events = await r.json();
    const remaining = r.headers.get("x-requests-remaining");

    const cutoff = Date.now() + days*86400000;
    const rows = [], skipped = [];

    events
      .filter(e => new Date(e.commence_time).getTime() < cutoff)
      .sort((a,b)=> a.commence_time.localeCompare(b.commence_time))
      .forEach(e=>{
        const away = ABBR[e.away_team], home = ABBR[e.home_team];
        if(!away || !home){ skipped.push(`${e.away_team} @ ${e.home_team} (unknown team)`); return; }

        const mkt = e.bookmakers?.[0]?.markets?.find(m=>m.key==="spreads");
        if(!mkt){ skipped.push(`${away} @ ${home} (no spread posted)`); return; }

        // Favourite is the side with the negative handicap. A 0/0 line is a
        // pick'em, which the paste parser handles as PK.
        const fav = mkt.outcomes.find(o=>Number(o.point) < 0);
        let spread;
        if(!fav){
          spread = "PK";
        } else {
          spread = `${ABBR[fav.name]} ${fav.point}`;
        }

        rows.push(`${away.padEnd(3)} @ ${home.padEnd(3)} | ${spread.padEnd(9)} | ${etStamp(e.commence_time)}`);
      });

    res.setHeader("Cache-Control","no-store");
    return res.status(200).json({ text: rows.join("\n"), count: rows.length, skipped, remaining });

  }catch(err){
    return res.status(500).json({error:"Fetch failed", detail:String(err.message)});
  }
}
