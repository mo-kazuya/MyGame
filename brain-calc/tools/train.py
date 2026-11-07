import sys
import numpy as np, gzip, torch, torch.nn as nn, torch.nn.functional as F, sys, json, base64, time
torch.manual_seed(0); np.random.seed(0)
D=(sys.argv[4] if len(sys.argv)>4 else 'data')+'/'
def mn(f, off, shape): return np.frombuffer(gzip.open(D+f).read()[off:], np.uint8).reshape(shape)
Mx=mn('train-images-idx3-ubyte.gz',16,(-1,28,28)); My=mn('train-labels-idx1-ubyte.gz',8,(-1,))
Tx=mn('t10k-images-idx3-ubyte.gz',16,(-1,28,28)); Ty=mn('t10k-labels-idx1-ubyte.gz',8,(-1,))
Px=np.fromfile('pd_train.x',np.uint8).reshape(-1,28,28); Py=np.fromfile('pd_train.y',np.uint8)
Qx=np.fromfile('pd_test.x',np.uint8).reshape(-1,28,28); Qy=np.fromfile('pd_test.y',np.uint8)
use_pd = sys.argv[1]=='mix'; epochs=int(sys.argv[2]); out=sys.argv[3]
X=np.concatenate([Mx,Px]) if use_pd else Mx; Y=np.concatenate([My,Py]) if use_pd else My
isM=np.concatenate([np.ones(len(Mx),bool),np.zeros(len(Px),bool)]) if use_pd else np.ones(len(Mx),bool)
X=torch.tensor(X,dtype=torch.float32).unsqueeze(1)/255; Y=torch.tensor(Y,dtype=torch.long); isM=torch.tensor(isM)
class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.c1=nn.Conv2d(1,16,3,padding=1); s.c2=nn.Conv2d(16,32,3,padding=1); s.c3=nn.Conv2d(32,48,3,padding=1)
        s.f1=nn.Linear(48*3*3,64); s.f2=nn.Linear(64,10); s.dp=nn.Dropout(0.25)
    def forward(s,x):
        x=F.max_pool2d(F.relu(s.c1(x)),2); x=F.max_pool2d(F.relu(s.c2(x)),2); x=F.max_pool2d(F.relu(s.c3(x)),2)
        return s.f2(s.dp(F.relu(s.f1(x.flatten(1)))))
def affine(x):
    # MNIST にだけ、ゆがみ（回転・斜体・拡大・ずれ）を加える
    n=x.shape[0]; th=(torch.rand(n)-.5)*0.4; sh=(torch.rand(n)-.5)*0.5; sc=0.85+torch.rand(n)*0.25
    c,s=torch.cos(th),torch.sin(th)
    A=torch.zeros(n,2,3); A[:,0,0]=c/sc; A[:,0,1]=(-s+sh)/sc; A[:,1,0]=s/sc; A[:,1,1]=c/sc
    A[:,:,2]=(torch.rand(n,2)-.5)*0.2
    return F.grid_sample(x,F.affine_grid(A,x.shape,align_corners=False),align_corners=False)
net=Net(); opt=torch.optim.Adam(net.parameters(),2e-3)
sched=torch.optim.lr_scheduler.OneCycleLR(opt,3e-3,total_steps=epochs*(len(X)//128+1))
def acc(m,x,y):
    m.eval()
    with torch.no_grad():
        p=torch.cat([m(torch.tensor(x[i:i+2000],dtype=torch.float32).unsqueeze(1)/255).argmax(1) for i in range(0,len(x),2000)])
    m.train(); return (p.numpy()==y).mean(), p.numpy()
for ep in range(epochs):
    t=time.time(); perm=torch.randperm(len(X))
    for i in range(0,len(X),128):
        idx=perm[i:i+128]; xb=X[idx].clone(); m=isM[idx]
        if m.any(): xb[m]=affine(xb[m])
        loss=F.cross_entropy(net(xb),Y[idx],label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    a1,_=acc(net,Tx,Ty); a2,_=acc(net,Qx,Qy)
    print(f'ep{ep} loss {loss.item():.3f} MNIST-test {a1:.4f} pendigits-test(未知の14人) {a2:.4f} {time.time()-t:.0f}s',flush=True)
torch.save(net.state_dict(),out+'.pt')
# int8 にして書き出す
layers=[]; blobs=[]
for name,p in net.state_dict().items():
    w=p.numpy().astype(np.float32); sc=float(np.abs(w).max()/127) or 1.0
    q=np.clip(np.round(w/sc),-127,127).astype(np.int8); blobs.append(q.tobytes())
    layers.append({'name':name.replace('.weight','.w').replace('.bias','.b'),'shape':list(w.shape),'scale':sc})
m={'layers':layers,'data':base64.b64encode(b''.join(blobs)).decode()}
open(out+'.js','w').write("'use strict';\n// 手書き数字を読み取るニューラルネットの重み（int8）。学習：MNIST + UCI pen-based digits\n(function (m) { if (typeof module !== 'undefined' && module.exports) module.exports = m; else window.HW_MODEL = m; })("+json.dumps(m)+");\n")
print('params',sum(p.numel() for p in net.parameters()),'bytes',len(open(out+'.js').read()))
