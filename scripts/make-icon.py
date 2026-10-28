# Иконка приложения из логотипа дайджеста (градиент + график). Запуск: python3 scripts/make-icon.py
from PIL import Image, ImageDraw
S=1024; k=S/40
g=Image.new('RGBA',(S,S))
a=(0x4B,0x6B,0xF0); b=(0x2E,0x9A,0x6E)
px=g.load()
for y in range(S):
    for x in range(S):
        t=(x+y)/(2*S); px[x,y]=tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))+(255,)
m=Image.new('L',(S,S),0); ImageDraw.Draw(m).rounded_rectangle([k*1,k*1,k*39,k*39],radius=k*12,fill=255)
img=Image.new('RGBA',(S,S)); img.paste(g,(0,0),m)
d=ImageDraw.Draw(img)
d.arc([k*11,k*12,k*29,k*30],start=150,end=495,fill=(255,255,255,128),width=int(k*2))
d.line([(k*12,k*26),(k*18,k*21),(k*22,k*24),(k*29,k*15)],fill='white',width=int(k*2.6),joint='curve')
for (x,y) in [(12,26),(18,21),(22,24)]: d.ellipse([k*x-k*1.3,k*y-k*1.3,k*x+k*1.3,k*y+k*1.3],fill='white')
d.ellipse([k*26.2,k*12.2,k*31.8,k*17.8],fill='white')
img.resize((512,512),Image.LANCZOS).save('build/icon.png')
img.resize((256,256),Image.LANCZOS).save('build/icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('ok')
