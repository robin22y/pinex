import requests
from bs4 import BeautifulSoup

url = "https://www.screener.in/company/APTUS/consolidated/"
headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

response = requests.get(url, headers=headers)
soup = BeautifulSoup(response.text, 'html.parser')

# Find quarterly results section
quarters_section = soup.find('section', {'id': 'quarters'})
if not quarters_section:
    print("No quarters section found")
else:
    table = quarters_section.find('table')
    if table:
        rows = table.find('tbody').find_all('tr')
        print("ROW LABELS FOUND:")
        for row in rows:
            cells = row.find_all('td')
            if cells:
                print(" ", cells[0].text.strip())
    else:
        print("No table found in quarters section")