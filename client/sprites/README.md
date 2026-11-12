# Character sprites

Drop one PNG per character here and point `CHARS[i].sprite` at it in
`shared/constants.js`, e.g. `sprite: 'sprites/lion.png'`.

Requirements:
- transparent background, no shadow, no ground
- side view, facing RIGHT, whole body in frame
- feet touching the bottom edge of the image
- about 400-600 px tall; the game scales it down
- the same framing for every character, so they match in size on the track

A character with no sprite keeps the drawn vector art, so the set can be
filled in one at a time.
