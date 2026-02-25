# engvocvn

engvocvn is a lightweight TOEIC vocabulary web app focused on long-term retention using spaced repetition and mixed practice formats.

## Live Demo

GitHub Pages: https://thanhdat7d2.github.io/engvocvn/

## What You Can Do

- Learn new words in focused sessions.
- Review previously learned words with adaptive scheduling.
- Practice with multiple quiz types:
  - Meaning -> Word (multiple choice)
  - Meaning -> Word (typing)
  - Word -> Meaning (multiple choice)
  - Example -> Meaning (multiple choice)
  - Audio -> Meaning (multiple choice)
  - Synonym / Antonym (multiple choice)
- Track progress in the Learned Words panel.
- Replay pronunciation audio when available.

## How It Works

- Each word has a learning state (stability, difficulty, mastery by review type).
- Correct answers increase recall interval.
- Wrong answers reduce stability and bring words back sooner.
- Progress is saved in browser `localStorage`.

## Tech Stack

- HTML, CSS, JavaScript (Vanilla, no framework)
- Static JSON dataset (`data/data.json`)
- Browser's local storage to persist learning progress

## Project Structure

```text
.
├─ index.html
├─ audio/
├─ data/
│  └─ data.json
├─ font/
├─ icon/
├─ script/
│  ├─ app.js
│  ├─ reviewEngine.js
│  ├─ scheduler.js
│  ├─ sessionBuilder.js
│  ├─ storage.js
│  └─ wordState.js
└─ style/
   └─ app.css
```

## Run Locally

Because the app loads JSON and ES modules, run it with a local server.

### Option 1: VS Code Live Server

1. Open the project in VS Code.
2. Install the Live Server extension.
3. Right-click `index.html` and choose **Open with Live Server**.

### Option 2: Python

```bash
python -m http.server 5500
```

Open http://localhost:5500

## Notes

- Audio playback depends on available pronunciation links in your dataset.
- Use **Delete all learned words** in-app to reset progress.

## Author

Nguyễn Thành Đạt (GitHub: thanhdat7d2)
