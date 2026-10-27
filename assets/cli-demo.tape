# CLI demo GIF for the READMEs. Regenerate from the repo root: vhs assets/cli-demo.tape
# Needs vhs, ttyd and ffmpeg, and NEXIS_API_KEY saved as a user environment variable.
Output assets/cli-demo.gif

Set Shell "powershell"
Set FontSize 20
Set Width 1200
Set Height 230
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 35ms

# Short prompt and the API key.
Hide
Type `function prompt { '> ' }; $env:NEXIS_API_KEY = [Environment]::GetEnvironmentVariable('NEXIS_API_KEY','User'); Clear-Host`
Enter
Sleep 2s
Show

Type `npx @intelation/nexis redact "Patient Jane Doe, jane.doe@example.com, NHS 943 476 5919"`
Sleep 400ms
Enter
Sleep 3s

Type `npx @intelation/nexis tokenization "Patient Jane Doe, jane.doe@example.com, NHS 943 476 5919"`
Sleep 400ms
Enter
Sleep 4s
