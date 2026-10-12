"""Reproduce the verified PDF calendar seed. Requires pdfplumber. Never infer rotation."""
from pathlib import Path
import calendar,datetime,hashlib,json
import pdfplumber
root=Path(__file__).resolve().parents[1]
source=root/'sources/ia-calendar-2026-2027.pdf'
p=pdfplumber.open(source).pages[0]
words=p.extract_words()
months=['August','September','October','November','December','January','February','March','April','May','June']
# Each month is a seven-column grid. Determine each date's cell from its printed number.
result=[]
for index,name in enumerate(months):
    heading=next(w for w in words if w['text']==name)
    rect=next(r for r in p.rects if r['x0']<=heading['x0'] and r['x1']>=heading['x1'] and r['top']<=heading['top']<r['bottom'] and r['width']>160 and r['height']<20)
    x0=rect['x0'];top=rect['bottom']+16.56; year=2026 if index<5 else 2027;month=(index+7)%12+1
    for day in range(1,calendar.monthrange(year,month)[1]+1):
        date=datetime.date(year,month,day);col=(date.weekday()+1)%7
        first_printed=2 if name in ('August','May') else 1
        offset=(datetime.date(year,month,1).weekday()+1)%7
        row=(day+offset-1)//7-(first_printed+offset-1)//7
        cx=x0+col*24+12;cy=top+row*16.68+8
        fills=[r for r in p.rects if r['x0']<=cx<r['x1'] and r['top']<=cy<r['bottom'] and r['width']>20 and 16<r['height']<18]
        fill=fills[-1]['non_stroking_color'] if fills else (1,1,1)
        closed=date.weekday()>=5 or fill in [(1.0,1.0,0.0),(0.0,0.0,0.0)] or date<datetime.date(2026,8,19) or date>datetime.date(2027,6,10)
        blue=fill==(0.705882,0.776471,0.905882)
        cell=p.crop((x0+col*24+0.02,top+row*16.68-0.02,x0+(col+1)*24-0.02,top+(row+1)*16.68-0.02)).extract_text() or ''
        early='ER' in cell and not closed
        notes=[]
        if 'M' in cell and date.month==12 and 15<=day<=18 and not closed:notes.append('Midterms — full day of school')
        if '★' in cell:notes.append('End of quarter')
        for code,label in [('PD','Professional development'),('TW','Teacher workday'),('MD','Management day'),('CF','Conferences'),('CC','Conference compensation'),('D3','All-staff D3')]:
            if code in cell:notes.append(label)
        if closed and not notes:notes.append('No school')
        result.append({'date':date.isoformat(),'cycle':None if closed else 'B' if blue else 'A','dayType':'no-school' if closed else 'early-release' if early else 'normal','dismissal':'11:00' if early else '','notes':'; '.join(notes)})
# August 1 is not printed in the source grid. Add only that explicit weekend.
result.append({'date':'2026-08-01','cycle':None,'dayType':'no-school','dismissal':'','notes':'Weekend'})
result=sorted({d['date']:d for d in result}.values(),key=lambda d:d['date'])
assert len(result)==334,len(result)
assert sum(d['cycle'] is not None for d in result)==180
seed={'school':'International Academy','year':'2026-2027','timeZone':'America/Detroit','sourceUrl':'https://www.iatoday.org/tri-campus/graphic-calendar','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'verifiedAt':'2026-10-08','revision':1,'dates':result}
(root/'data/school-calendar-2026-2027.json').write_text(json.dumps(seed,indent=2)+'\n')
print('Verified extraction: 334 dates, 180 student school days')
