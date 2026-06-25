# Microsoft Defender false-positive submission notes

Use this release packet when submitting the app to Microsoft Security Intelligence:

https://www.microsoft.com/en-us/wdsi/filesubmission

Recommended submission type:

- Submit as: Software developer
- Product: Microsoft Defender Antivirus / Microsoft Defender SmartScreen
- Classification: Incorrectly detected as malware/malicious

Product:

- Name: PRISM Worldgen Lab
- Publisher: FBZ / PRISM
- Repository: https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab
- Release: https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab/releases/tag/v0.1.0

Artifacts to submit if flagged:

- PRISM-Worldgen-Lab-0.1.0-portable-windows-x64.zip
- installer/PRISM-Worldgen-Lab-0.1.0-windows-x64-setup.exe
- installer/PRISM-Worldgen-Lab-0.1.0-windows-x64.msi


Notes:

This is a Tauri desktop application built from public source. It is unsigned
unless a Windows Authenticode certificate is passed to the release script. The
Tauri updater signature protects update integrity, but Windows Defender and
SmartScreen reputation still depend on Microsoft reputation and Authenticode
publisher trust.