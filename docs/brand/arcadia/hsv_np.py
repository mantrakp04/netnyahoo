"""RGB <-> HSV on numpy arrays (build.py)."""
import numpy as np
def rgb_to_hsv(rgb):
    r,g,b = rgb[...,0],rgb[...,1],rgb[...,2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx-mn
    h = np.zeros_like(mx)
    m = d>1e-6
    rc = np.where(m,(mx-r)/np.where(m,d,1),0); gc = np.where(m,(mx-g)/np.where(m,d,1),0); bc = np.where(m,(mx-b)/np.where(m,d,1),0)
    h = np.where(r==mx, bc-gc, np.where(g==mx, 2+rc-bc, 4+gc-rc))
    h = np.where(m, (h/6)%1, 0)
    s = np.where(mx>1e-6, d/np.where(mx>1e-6,mx,1), 0)
    return np.stack([h,s,mx],-1)
def hsv_to_rgb(hsv):
    h,s,v = hsv[...,0],hsv[...,1],hsv[...,2]
    i = np.floor(h*6).astype(int)%6; f = h*6-np.floor(h*6)
    p=v*(1-s); q=v*(1-s*f); t=v*(1-s*(1-f))
    r=np.choose(i,[v,q,p,p,t,v]); g=np.choose(i,[t,v,v,q,p,p]); b=np.choose(i,[p,p,t,v,v,q])
    return np.stack([r,g,b],-1)
def to_rgb(h):
    h=h.lstrip('#'); return np.array([int(h[i:i+2],16)/255 for i in (0,2,4)])
