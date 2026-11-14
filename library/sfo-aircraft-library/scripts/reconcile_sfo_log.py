"""Attach independently attributed, dated receiver-log records to fleet tasks."""
import csv
import datetime
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = Path(__file__).resolve().parents[1]/'assets/airliners/traffic'
DATE = '2026-11-11'
SOURCE = BASE/(DATE+'-aeropattern-flightlog.csv')
LOCAL = ZoneInfo('America/Los_Angeles')

# Explicit registration resolution avoids treating trustee names as operators.
# The selected paint remains representative where the exact stripe art awaits
# a photograph of that airframe on the captured date.
ASSIGNMENTS = [
    ('NetJets','GL5T','gl5t/netjets','N132QS N134QS N144QS'),
    ('NetJets','CL60','cl60/netjets','N246QS N255QS N267QS'),
    ('NetJets','C700','c700/netjets','N862QS N870QS'),
    ('Flexjet','E545','e545/flexjet','N261FX N329FX N435FX N448FX'),
    ('Silver Air','GLF5','glf5/silver-air','N550AG'),
    ('Neojets','GALX','galx/neojets','N196X'),
    ('Baker Aviation','C750','c750/baker-aviation','N513JB N51GB'),
    ('Hera Flight','C750','c750/herajet','N702FL'),
    ('Vista America','CL30','cl30/vista-america','N536XJ N539XJ'),
    ('Solairus','CL30','cl30/twy-n1013','N1013'),
    ('Vista America','CL35','cl35/vista-america','N360VJ'),
    ('Flexjet','CL35','cl35/flexjet','N512FX N578FX N595FX'),
    ('NetJets','CL35','cl35/netjets','N750QS N752QS'),
    ('Flexjet','GLF4','glf4/flexjet','N488FX'),
    ('Thoma Bravo','GLF6','glf6/thoma-bravo','N613HB'),
    ('Jet Aviation','GA5C','ga5c/jet-aviation','N503F'),
    ('ConocoPhillips','GA5C','ga5c/conocophillips','N797CP'),
    ('NetJets','GLEX','glex/netjets','N166QS'),
    ('VistaJet','GLEX','glex/vistajet','9HVJS'),
    ('NetJets','GL7T','gl7t/netjets','N186QS'),
    ('Jet Access Aviation','C25B','c25b/jet-access','N327TX'),
    ('flyExclusive','C25B','c25b/flyexclusive','N749JS'),
    ('Silver Air','C25B','c25b/silver-air','N294PW'),
    ('Pacific Coast Jet','C56X','c56x/pacific-coast','N420DL'),
    ('NetJets','E55P','e55p/netjets','N306QS'),
    ('Private N707HD','H25C','h25c/private-n707hd','N707HD'),
    ('SkyCare','ASTR','astr/skycare','CFDAX'),
    ('Optimal Aviation','B350','b350/optimal-aviation','N359DG'),
    ('REACH Air Medical','BE20','be20/reach','N913RX'),
    ('Blue Skies California','BE9L','be9l/blue-skies','N991GT'),
    ('Guardian Flight','PC12','pc12/guardian-flight','LN271SM N271SM'),
    ('Private N999FN','EPIC','epic/private-n999fn','N999FN'),
    ('REACH Air Medical','EC35','ec35/reach','N329RX'),
    ('CALSTAR','EC35','ec35/calstar','N31RX'),
]
REGISTRATIONS = {
    tail:dict(operator=operator,icaoType=kind,assetSelector=asset)
    for operator,kind,asset,tails in ASSIGNMENTS for tail in tails.split()
}


def main():
    groups = {}
    all_rows = []
    for row in csv.DictReader(SOURCE.open()):
        arrival = row['direction']=='arrival'
        event = row['actual_arrival' if arrival else 'actual_departure']
        scheduled = row['scheduled_arrival' if arrival else 'scheduled_departure']
        timestamp_conflict = bool(event and scheduled and abs((
            datetime.datetime.fromisoformat(event)-datetime.datetime.fromisoformat(scheduled)
        ).total_seconds())>12*3600)
        if timestamp_conflict:
            event = None
        timestamp = event or scheduled
        if not timestamp or row['status']=='cancelled':
            continue
        local = datetime.datetime.fromisoformat(timestamp).astimezone(LOCAL)
        if local.date().isoformat()!=DATE:
            continue
        all_rows.append(row)
        assignment = REGISTRATIONS.get(row['tail_number'])
        if not assignment:
            continue
        identity = assignment['operator']+'/'+assignment['icaoType']
        entry = groups.setdefault(identity,dict(
            id=identity,**assignment,status='pending',iata=assignment['operator'],
            source='AeroPattern dated receiver log',
            flights=[],evidence=[
                'https://aeropattern.com/api/airports/KSFO/flightlog.csv?range=7d',
                DATE+'-registration-identifications.json'
            ],
            paintMatch='Representative operator paint. Exact registration stripe layout requires visual review.'
        ))
        entry['flights'].append(dict(
            flight=row['callsign'],direction='Arrival' if arrival else 'Departure',
            scheduled=datetime.datetime.fromisoformat(scheduled).astimezone(LOCAL).isoformat() if scheduled else local.isoformat(),
            observed=local.isoformat() if event else None,
            status=row['status'],registration=row['tail_number'],
            origin=row['origin'],destination=row['destination']
        ))
    # The public late-evening board additionally reports these assignments.
    additional = [
        ('Baker Aviation/C750','KOW51','N51GB','2026-11-11T20:49:00-08:00'),
        ('Vista America/CL30','VJA539','N539XJ','2026-11-11T22:21:00-08:00'),
        ('Flexjet/GLF4','LXJ488','N488FX','2026-11-11T22:40:00-08:00'),
        ('Private N707HD/H25C','N707HD','N707HD','2026-11-11T21:38:00-08:00'),
        ('SkyCare/ASTR','CFDAX','CFDAX','2026-11-11T23:07:00-08:00')
    ]
    for identity,flight,tail,timestamp in additional:
        assignment=REGISTRATIONS[tail]
        entry=groups.setdefault(identity,dict(
            id=identity,**assignment,status='pending',iata=assignment['operator'],
            source='Dated public tracking board',flights=[],evidence=[],
            paintMatch='Representative operator paint. Exact registration stripe layout requires visual review.'
        ))
        if any(f['flight']==flight for f in entry['flights']):
            continue
        entry['evidence'].append('https://www.flightradar24.com/data/airports/sfo/arrivals')
        entry['flights'].append(dict(
            flight=flight,direction='Arrival',scheduled=timestamp,
            status='Scheduled or estimated in the saved dated public board',
            registration=tail
        ))
    abx='ABX Air/B763'
    groups[abx]=dict(
        id=abx,operator='ABX Air',iata='GB',icaoType='B763',
        assetSelector='b763f/abx-air',status='pending',
        source='AeroPattern dated receiver log',
        flights=[dict(flight=r['callsign'],direction='Departure',
            scheduled=r['scheduled_departure'],observed=r['actual_departure'],
            registration=r['tail_number'],status=r['status'])
            for r in all_rows if r['callsign']=='ABX1820'],
        evidence=['https://aeropattern.com/airports/KSFO']
    )
    for identity,operator,reg,kind,selector in [
        ('VS/B789','Virgin Atlantic','G-VCRU','B789','b789-current/virgin-atlantic'),
        ('TP/A339','TAP Air Portugal','CS-TUE','A339','a339/tap-portugal'),
    ]:
        matching=[row for row in all_rows if row['tail_number']==reg]
        groups[identity]=dict(
            id=identity,operator=operator,iata=identity.split('/')[0],icaoType=kind,
            assetSelector=selector,status='pending',
            source='AeroPattern dated receiver log',
            evidence=['https://aeropattern.com/airports/KSFO',
                      'https://www.airnavradar.com/data/flights/VS19' if kind=='B789'
                      else 'https://planefinder.net/data/aircraft/CS-TUE'],
            flights=[dict(
                flight=row['callsign'],direction=row['direction'],
                scheduled=row['scheduled_arrival' if row['direction']=='arrival' else 'scheduled_departure'],
                observed=row['actual_arrival' if row['direction']=='arrival' else 'actual_departure'],
                registration=reg,status=row['status']
            ) for row in matching]
        )
    groups['F9/A21N']=dict(
        id='F9/A21N',operator='Frontier',iata='F9',icaoType='A21N',
        assetSelector='a21n/frontier-chopper',status='pending',
        source='Dated public tracking board',
        evidence=['https://www.flightradar24.com/data/airports/sfo/departures',
                  'https://www.flightradar24.com/data/aircraft/n607fr/'],
        flights=[dict(flight='F92858',direction='Departure',
                      scheduled='2026-11-11T21:27:00-08:00',
                      status='Scheduled or estimated in the dated public board')],
        paintMatch='Chopper is a documented A321-271NX operator livery, supplied as representative paint. Assignment to the captured movement remains unverified. The shark artwork is an original generated reconstruction.'
    )
    payload=dict(
        dateLocal=DATE,source=SOURCE.name,
        sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        capturedOperatingRows=len(all_rows),
        scope='Additional aircraft/operator assignments in the dated receiver log and late public board. These records supplement the official snapshots. Scheduled and observed timestamps retain their source meaning.',
        combinations=list(groups.values())
    )
    (BASE/(DATE+'-supplemental-combinations.json')).write_text(json.dumps(payload,indent=2)+'\n')
    print('Supplemental combinations',len(groups),'dated receiver rows',len(all_rows))


if __name__=='__main__':
    main()
