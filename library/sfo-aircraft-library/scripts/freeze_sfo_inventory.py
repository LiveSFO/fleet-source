"""Build inventory from SFO's published operating flights, excluding codeshares.
A dated rolling snapshot is evidence, not a claim of a complete future day's traffic.
"""
import pathlib,json,collections,datetime
base=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners/traffic';date='2026-11-11'
snapshots=[base/'official-flights.json',*sorted(base.glob(date+'-official-*.json'))]
unique={};official_snapshots=[]
for path in snapshots:
 d=json.loads(path.read_text())
 rows=[r for r in d['data'] if r['scheduled_date']==date and r['airline']['iata_code']==r['flight_id'].split('/')[0]]
 if not rows:continue
 times=[r['scheduled_aod_time'] for r in rows]
 official_snapshots.append({'file':path.name,'lastUpdate':d['last_update'],'operatingRows':len(rows),'coverageLocal':[min(times),max(times)]})
 for row in rows:unique[row['flight_id']]=row
combos={}
for f in unique.values():
 airline=f['airline'];typ=f.get('aircraft_transport_type',{}).get('icao_code') or 'UNKNOWN';key=airline['iata_code']+'/'+typ
 entry=combos.setdefault(key,{'id':key,'operator':airline['airline_display_name'],'iata':airline['iata_code'],'icaoType':typ,'flights':[],'status':'pending','evidence':['SFO official flight-status feed']})
 entry['flights'].append({'flight':f['flight_id'],'direction':f['flight_kind'],'scheduled':f['scheduled_aod_time'],'status':f['remark']})
# Public receiver table adds all-cargo, private operations and special paint visible
# in the captured window. Keep their independent source attribution.
for which in ['arrivals','departures']:
 d2=json.loads((base/('fr24-'+which+'-structured.json')).read_text())
 for f in d2['@graph']:
  if f.get('@type')!='Flight':continue
  time=f.get('arrivalTime') or f.get('departureTime');dt=datetime.datetime.fromisoformat(time).astimezone(datetime.timezone(datetime.timedelta(hours=-8)))
  if dt.date().isoformat()!=date:continue
  airline=f['provider'];typ=f.get('aircraft') or 'UNKNOWN';code=airline.get('iataCode') or airline['name'];key=code+'/'+typ
  # Preserve special paint as an additional combination even where base airline
  # and airframe are already in the airport list.
  if 'Livery' in airline['name']:key+=' / '+airline['name']
  entry=combos.setdefault(key,{'id':key,'operator':airline['name'],'iata':code,'icaoType':typ,'flights':[],'status':'pending','evidence':[]})
  if 'Flightradar24 public board' not in entry['evidence']:entry['evidence'].append('Flightradar24 public board')
  entry['flights'].append({'flight':f['flightNumber'],'direction':which,'scheduled':dt.isoformat(),'status':'Published schedule/assignment; subject to change'})
identifications=base/(date+'-flight-identifications.json')
if identifications.exists():
 for old_id,record in json.loads(identifications.read_text()).items():
  if record.get('split'):
   previous=combos[old_id]
   flights=[flight for flight in previous['flights'] if flight['flight']==record['flight']]
   assert flights,(old_id,record['flight'])
   previous['flights']=[flight for flight in previous['flights'] if flight['flight']!=record['flight']]
   entry={**previous,'flights':flights,'evidence':previous['evidence'].copy()}
  else:entry=combos.pop(old_id)
  entry.update({k:v for k,v in record.items() if k in ('id','icaoType','specialLivery')})
  for flight in entry['flights']:
   if flight['flight']==record['flight']:
    flight.update({k:v for k,v in record.items() if k in ('registration','representativeRegistration','detail','sourceURLs')})
  entry['evidence'].extend(record['sourceURLs'])
  combos[entry['id']]=entry
supplement=base/(date+'-supplemental-combinations.json')
if supplement.exists():
 for incoming in json.loads(supplement.read_text())['combinations']:
  entry=combos.setdefault(incoming['id'],{**incoming,'flights':[],'evidence':[]})
  entry.update({key:value for key,value in incoming.items() if key not in ('flights','evidence')})
  seen={(flight['flight'],flight.get('direction'),flight.get('scheduled')) for flight in entry['flights']}
  entry['flights'].extend(flight for flight in incoming['flights'] if (flight['flight'],flight.get('direction'),flight.get('scheduled')) not in seen)
  entry['evidence']=list(dict.fromkeys(entry['evidence']+incoming['evidence']))
rows=sorted(combos.values(),key=lambda q:(-len(q['flights']),q['id']))
out={'dateLocal':date,'timezone':'America/Los_Angeles','airport':'KSFO','frozenAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'officialOperatingFlights':len(unique),'officialSnapshots':official_snapshots,'officialCoverageLocal':[min(f['scheduled_aod_time'] for f in unique.values()),max(f['scheduled_aod_time'] for f in unique.values())],'scope':'All published combinations in the saved SFO flight-status snapshots, plus separately attributed receiver-board and AeroPattern log assignments for cargo, private aircraft and special liveries. Scheduled and observed rows retain their source meaning. See individual snapshot coverage intervals; this is not a complete audited record of every operation.','sourceURLs':['https://www.flysfo.com/passengers/flight-info/flight-status','https://www.flysfo.com/flysfo/api/flight-status','https://www.flightradar24.com/data/airports/sfo/arrivals','https://www.flightradar24.com/data/airports/sfo/departures','https://aeropattern.com/api/airports/KSFO/flightlog.csv?range=7d'],'supplementalCapture':({k:v for k,v in json.loads(supplement.read_text()).items() if k!='combinations'} if supplement.exists() else None),'combinations':rows}
(base/(date+'-build-inventory.json')).write_text(json.dumps(out,indent=2));print('Frozen',len(rows),'combinations,',len({r['icaoType'] for r in rows}),'aircraft codes;',len(unique),'official flights')
