from db import supabase

# Check all data grouped by date
result = supabase.table('nifty_sectors').select('date').execute()
if result.data:
    from collections import Counter
    dates = Counter(row['date'] for row in result.data)
    print('Sectors by date:')
    for date, count in sorted(dates.items(), reverse=True)[:10]:
        print(f'  {date}: {count} records')
    print(f'\nTotal: {len(result.data)} records')
else:
    print('No data found')
