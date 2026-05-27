#!/usr/bin/env python3
from supabase import create_client
import os
from dotenv import load_dotenv
load_dotenv()
client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])
resp = client.table('events').select('id', count='exact').execute()
print(f'최종 이벤트 수: {resp.count}개')
