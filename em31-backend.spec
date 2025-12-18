# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['/home/ministrum/Documents/Projet-EM31/backend/app.py'],
    pathex=[],
    binaries=[],
    datas=[('/home/ministrum/Documents/Projet-EM31/frontend', 'frontend'), ('/home/ministrum/Documents/Projet-EM31/tiles', 'tiles'), ('/home/ministrum/Documents/Projet-EM31/pyEM31-main', 'pyEM31-main')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='em31-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
