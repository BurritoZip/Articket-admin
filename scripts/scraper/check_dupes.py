#!/usr/bin/env python3
from supabase import create_client
import os
from dotenv import load_dotenv
from collections import defaultdict

load_dotenv()
client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])

all_events = []
offset = 0
while True:
    resp = client.table("events").select("id,title,venue_id,artist_id,start_date,end_date,dedup_key").range(offset, offset+999).execute()
    rows = resp.data or []
    all_events.extend(rows)
    if len(rows) < 1000:
        break
    offset += 1000

print(f"남은 이벤트: {len(all_events)}개\n")

# 제목이 완전히 같은 것들
title_groups = defaultdict(list)
for e in all_events:
    title = (e.get('title') or '').strip()
    title_groups[title].append(e)

dups = {t: g for t, g in title_groups.items() if len(g) > 1}
print(f"같은 제목 그룹: {len(dups)}개")
for title, group in sorted(dups.items(), key=lambda x: -len(x[1]))[:30]:
    venues = [str(e.get('venue_id',''))[:8] for e in group]
    same_venue = len(set(str(e.get('venue_id','')) for e in group)) == 1
    flag = " *** 동일 venue" if same_venue else ""
    print(f"  [{len(group)}개{flag}] '{title[:60]}' | venues:{set(venues)}")

# dedup_key 중복
dedup_groups = defaultdict(list)
for e in all_events:
    k = (e.get('dedup_key') or '').strip()
    if k:
        dedup_groups[k].append(e)
key_dups = {k: g for k, g in dedup_groups.items() if len(g) > 1}
print(f"\ndedup_key 중복: {len(key_dups)}그룹")
for k, g in list(key_dups.items())[:10]:
    print(f"  [{len(g)}개] key='{k[:40]}' titles:{[x['title'][:30] for x in g]}")
