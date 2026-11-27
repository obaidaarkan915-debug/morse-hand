import {
  Session,
  HandSelector,
  observe,
  CODE_OF,
} from "./engine.js";

const $ = (id) => document.getElementById(id);
const icons = {
  scan: "M8 3H4v4m12-4h4v4M4 17v4h4m12-4v4h-4 M8 12h8",
  pulse: "M2 12h5l3-8 4 16 3-8h5",
  sound: "M3 9h4l5-4v14l-5-4H3z M16 8q4 4 0 8m3-11q7 7 0 14",
  camera: "M3 6h12v12H3z M15 10l6-3v10l-6-3",
  keyboard: "M2 5h20v14H2z M5 9h1m3 0h1m3 0h1m3 0h1m-12 5h12",
  undo: "M8 4l-5 5 5 5M4 9h10a6 6 0 0 1 0 12",
  clear: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15",
  copy: "M8 8h12v13H8z M5 16H3V3h12v2",
  guide: "M12 6Q7 2 2 5v14q5-3 10 1 5-4 10-1V5q-5-3-10 1v14",
  settings: "M3 7h5m4 0h9M3 17h10m4 0h4 M8 4v6m8 4v6",
  shield: "M12 2l8 4v6q-1 7-8 10-7-3-8-10V6z M8 12l3 3 5-6",
};
for (const el of document.querySelectorAll("[data-icon]")) {
  el.innerHTML =
    '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="' +
    icons[el.dataset.icon] +
    '"/></svg>';
}
const video = document.querySelector("video"),
  overlay = $("overlay"),
  ctx = overlay.getContext("2d");
// The whole session (timing, decoder, gestures) runs in this tab. No server.
const session = new Session();
const clock = () => performance.now() / 1000;
let landmarker = null,
  selector = null,
  lastStamp = 0;
let wanted = "idle",
  mode = "idle",
  revision = 0,
  stream,
  audio,
  soundOutput,
  muted = false,
  held = false;
let decoded = "",
  applied = { dash: 2, character: 1.2, word: 2.8 };
const send = (op, value) => render(session.message(op, value, clock()));
const MORSE_UNIT = 0.10;
const MORSE_PITCH = 650;

function soundOn() {
  if (muted) return;
  try {
    if (!audio) {
      audio = new AudioContext();
      soundOutput = audio.createGain();
      soundOutput.connect(audio.destination);
    }
    if (audio.state !== "running") audio.resume().catch(() => {});
  } catch {
    // Typing and decoding still work on devices without Web Audio.
  }
}

function beep(symbol) {
  if (muted || audio?.state !== "running") return;
  const tone = audio.createOscillator();
  const envelope = audio.createGain();
  const start = audio.currentTime;
  const end = start + MORSE_UNIT * (symbol === "-" ? 3 : 1);
  tone.type = "sine";
  tone.frequency.value = MORSE_PITCH;
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(0.24, start + 0.008);
  envelope.gain.setValueAtTime(0.24, end - 0.018);
  envelope.gain.linearRampToValueAtTime(0, end);
  tone.connect(envelope).connect(soundOutput);
  tone.start(start);
  tone.stop(end);
}
function releaseCamera() {
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  video.srcObject = null;
}
function markMode() {
  $("camera").lastElementChild.textContent =
    wanted === "camera" ? "Stop Camera" : "Start Camera";
  $("demo").lastElementChild.textContent =
    wanted === "demo" ? "Exit Demo" : "Keyboard Demo";
  $("demo").setAttribute("aria-pressed", String(wanted === "demo"));
  $("source").textContent = wanted === "demo" ? "Keyboard" : "Camera";
  const live = !!stream && wanted === "camera";
  $("visual").style.display = live ? "block" : "none";
  $("standby").style.display = live ? "none" : "flex";
  $("previewTitle").textContent =
    wanted === "demo" ? "Hold the spacebar" : "Camera standby";
  $("previewHint").textContent =
    wanted === "demo"
      ? "Release for a symbol. Press Enter once per space."
      : "Start your camera to track a hand.";
}
async function changeMode(next) {
  const version = ++revision;
  held = false;
  releaseCamera();
  wanted = next;
  markMode();
  send("mode", "idle");
  if (next === "idle") return;
  soundOn();
  $("message").textContent = "";
  if (next === "demo") {
    send("mode", "demo");
    $("standby").tabIndex = 0;
    $("standby").focus({ preventScroll: true });
    return;
  }
  try {
    if (!navigator.mediaDevices)
      throw new Error("Camera access requires HTTPS or localhost.");
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
    });
    if (version !== revision) {
      acquired.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = acquired;
    video.srcObject = stream;
    await video.play();
    if (version !== revision) return;
    $("message").textContent = "Loading hand tracker…";
    await loadTracker();
    if (version !== revision) return;
    $("message").textContent = "";
    selector = new HandSelector();
    stream.getVideoTracks()[0].onended = () => {
      changeMode("idle");
      $("message").textContent =
        "Camera disconnected. Reconnect it and start again.";
    };
    markMode();
    send("mode", "camera");
  } catch (err) {
    if (version !== revision) return;
    changeMode("idle");
    const reason = {
      NotAllowedError:
        "Camera permission denied. Allow camera access in your browser or use Keyboard Demo.",
      NotFoundError: "No camera found. Connect a webcam or use Keyboard Demo.",
      NotReadableError:
        "Camera unavailable. Close other camera apps or use Keyboard Demo.",
    };
    $("message").textContent = reason[err.name] || err.message;
  }
}
$("camera").onclick = () => changeMode(wanted === "camera" ? "idle" : "camera");
$("demo").onclick = () => changeMode(wanted === "demo" ? "idle" : "demo");
$("sound").onclick = () => {
  muted = !muted;
  if (!muted) soundOn();
  if (soundOutput) soundOutput.gain.value = muted ? 0 : 1;
  $("sound").setAttribute("aria-pressed", String(muted));
  $("soundLabel").textContent = muted ? "Muted" : "Sound on";
};
for (const id of ["undo", "clear"]) $(id).onclick = () => send(id);
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(decoded);
    $("copy").lastElementChild.textContent = "Copied";
    setTimeout(() => ($("copy").lastElementChild.textContent = "Copy"), 1200);
  } catch {
    $("message").textContent =
      "Clipboard unavailable. Select the decoded text to copy it.";
  }
};
$("settings").onsubmit = (event) => {
  event.preventDefault();
  const values = Object.fromEntries(
    ["dash", "character", "word"].map((k) => [k, Number($(k).value)]),
  );
  if (values.word <= values.character) {
    $("message").textContent =
      "The word gap must be longer than the letter gap.";
    return;
  }
  values.automatic_spaces = $("automaticSpaces").checked;
  send("settings", values);
  applied = values;
  for (const [id, key] of [
    ["dashValue", "dash"],
    ["charValue", "character"],
  ])
    $(id).textContent = applied[key].toFixed(1);
  $("message").textContent = "Timing settings applied.";
};
document.addEventListener("keydown", (e) => {
  if (
    !["Space", "Enter"].includes(e.code) ||
    wanted !== "demo" ||
    e.target.closest("input,button,summary")
  )
    return;
  e.preventDefault();
  if (e.code === "Enter") {
    if (!held && !e.repeat) send("space");
    return;
  }
  if (!held && !e.repeat) {
    soundOn();
    held = true;
    send("down");
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space" && held) {
    e.preventDefault();
    held = false;
    send("up");
  }
});
window.addEventListener("blur", () => {
  if (held) {
    held = false;
    send("cancel");
  }
});
window.addEventListener("pagehide", () => {
  ++revision;
  releaseCamera();
});
const chains = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [5, 9, 13, 17, 0],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
  [4, 8],
];
function draw(points, spacing) {
  const w = overlay.width,
    h = overlay.height;
  ctx.clearRect(0, 0, w, h);
  if (!points.length) return;
  for (const chain of chains) {
    ctx.beginPath();
    ctx.strokeStyle = chain[0] === 4 ? "#c6ffc5" : "#f2fffc";
    ctx.lineWidth = 2;
    chain.forEach((n, i) =>
      ctx[i ? "lineTo" : "moveTo"](points[n][0] * w, points[n][1] * h),
    );
    ctx.stroke();
  }
  points.forEach(([x, y], i) => {
    const tip = spacing ? [4, 8, 12, 16, 20].includes(i) : i === 4 || i === 8;
    ctx.beginPath();
    ctx.arc(x * w, y * h, tip ? 6 : 2.4, 0, 2 * Math.PI);
    ctx.fillStyle = tip ? "#c6ffc5" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#24332f";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}
function toggleControls(online) {
  for (const id of ["camera", "demo", "undo", "clear"])
    $(id).disabled = !online;
  $("settings").querySelector("button").disabled = !online;
}
toggleControls(true);
$("lamp").className = "on";
$("connection").textContent = "Ready · runs in your browser";
function render(s) {
  mode = s.mode;
  renderPractice(s);
  decoded = s.text;
  if ($("status").textContent !== s.status) $("status").textContent = s.status;
  $("progress").value = s.progress;
  $("sequence").textContent =
    s.sequence.replaceAll(".", "·").replaceAll("-", "−") || " ";
  $("sequence").classList.toggle("empty", !s.sequence);
  const trailingSpaces = decoded.length - decoded.trimEnd().length;
  const hint = s.invalid
    ? "Unknown sequence. Undo a symbol or clear this sequence."
    : s.sequence
      ? "Pause to decode this letter"
      : s.pending
        ? "Space queued · start the next word"
        : trailingSpaces
          ? `${trailingSpaces} ${trailingSpaces === 1 ? "space" : "spaces"} added`
          : "Waiting for input";
  if ($("seqHint").textContent !== hint) $("seqHint").textContent = hint;
  $("clear").lastElementChild.textContent = s.invalid
    ? "Clear sequence"
    : "Clear";
  const displayed = decoded || "Your message appears here";
  if ($("text").textContent !== displayed) $("text").textContent = displayed;
  $("text").dataset.empty = String(!decoded);
  $("copy").disabled = !decoded;
  $("undo").disabled = $("clear").disabled = !(decoded || s.sequence);
  if (s.symbol) {
    beep(s.symbol);
    const panel = document.querySelector(".signal");
    panel.classList.remove("hit");
    void panel.offsetWidth;
    panel.classList.add("hit");
  }
  draw(s.points, s.status === "Hold for space");
  if (s.error) {
    if (wanted === "camera") changeMode("idle");
    $("message").textContent = s.error;
  }
}
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_SHA256 =
  "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
const WASM_DIR = new URL("./vendor/mediapipe/wasm", import.meta.url).href;
let loading = null;
function loadTracker() {
  // One shared load; a failed attempt can be retried by starting the camera again.
  loading ??= (async () => {
    const [{ FilesetResolver, HandLandmarker }, response] = await Promise.all([
      import("./vendor/mediapipe/vision_bundle.mjs"),
      fetch(MODEL_URL).catch(() => {
        throw new Error(
          "Could not download the hand model. Check your connection and try again.",
        );
      }),
    ]);
    if (!response.ok) throw new Error("Could not download the hand model.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== MODEL_SHA256)
      throw new Error("The downloaded hand model failed its SHA-256 check.");
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    const make = (delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: bytes, delegate },
        runningMode: "VIDEO",
        numHands: 2,
      });
    landmarker = await make("GPU").catch(() => make("CPU"));
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}
function detect(now) {
  const w = video.videoWidth,
    h = video.videoHeight;
  // detectForVideo needs strictly increasing millisecond timestamps.
  lastStamp = Math.max(lastStamp + 1, Math.round(now * 1000));
  const result = landmarker.detectForVideo(video, lastStamp);
  const hands = result.landmarks.map((landmarks, i) => ({
    landmarks,
    label: result.handedness[i][0].categoryName,
  }));
  return observe(selector, hands, w, h, now);
}
setInterval(() => {
  const now = clock();
  if (wanted !== "camera" || mode !== "camera" || !landmarker || video.readyState < 2) {
    render(session.message("tick", undefined, now));
    return;
  }
  const scale = Math.min(
    1,
    640 / Math.max(video.videoWidth, video.videoHeight),
  );
  const width = Math.round(video.videoWidth * scale),
    height = Math.round(video.videoHeight * scale);
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  try {
    render(session.frame(detect(now), now));
  } catch (err) {
    console.error(err);
    changeMode("idle");
    $("message").textContent = "Hand tracking failed. Reload the page and try again.";
  }
}, 80);

const sections = document.querySelectorAll("nav a");
function selectSection() {
  const hash = location.hash || "#studio";
  if (hash === "#timing") $("timing").open = true;
  for (const link of sections) {
    if (link.hash === hash) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
document.querySelector('a[href="#timing"]').addEventListener("click", () => {
  $("timing").open = true;
});
window.addEventListener("hashchange", selectSection);
selectSection();

async function loadAlphabet() {
  const status = $("referenceStatus");
  try {
    const alphabet = CODE_OF;
    referenceAlphabet = alphabet;
    for (const character of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
      const card = document.createElement("div");
      const label = document.createElement("dt");
      const code = document.createElement("dd");
      const practiceButton = document.createElement("button");
      practiceButton.textContent = character;
      practiceButton.setAttribute("aria-label", `Practice ${character}`);
      practiceButton.onclick = () => {
        focusPractice = true;
        send("practice", character);
      };
      label.append(practiceButton);
      code.textContent = alphabet[character]
        .replaceAll(".", "·")
        .replaceAll("-", "−");
      code.setAttribute(
        "aria-label",
        Array.from(alphabet[character], (mark) =>
          mark === "." ? "dot" : "dash",
        ).join(" "),
      );
      card.append(label, code);
      $("alphabet").append(card);
    }
    status.hidden = true;
    startGames(alphabet);
  } catch {
    status.textContent =
      "The alphabet could not load. Reload the page to try again.";
  }
}

const morseMarks = (code) => code.replaceAll(".", "·").replaceAll("-", "−");
let referenceAlphabet = {};
let practiceLetter = "";
let focusPractice = false;
$("practiceRetry").onclick = () => {
  send("practice", practiceLetter);
  if (wanted === "demo") $("standby").focus({ preventScroll: true });
};
$("practiceExit").onclick = () => {
  send("practice", "");
  $(wanted === "demo" ? "standby" : "camera").focus({ preventScroll: true });
};

function updateText(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value;
}

function renderPractice({ practice, attempt, sequence, invalid }) {
  $("practice").hidden = !practice;
  if (!practice) {
    practiceLetter = "";
    return;
  }
  const target = morseMarks(referenceAlphabet[practice] || "");
  updateText("practiceTitle", `Practice ${practice}`);
  updateText("practiceTarget", target || "");
  updateText("practiceAttempt", morseMarks(sequence || attempt) || "—");
  updateText(
    "practiceFeedback",
    !attempt || (sequence && !invalid)
      ? "Match the target pattern."
      : morseMarks(attempt) === target
        ? "Correct! Your pattern matches."
        : "Try again. Compare your dots and dashes with the target.",
  );
  practiceLetter = practice;
  if (focusPractice) {
    focusPractice = false;
    $("practiceTitle").focus();
  }
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function startGames(alphabet) {
  const letters = Object.keys(alphabet).filter((letter) =>
    /^[A-Z]$/.test(letter),
  );
  function choices(id, answer, onAnswer) {
    const group = $(id);
    group.replaceChildren();
    const alternatives = shuffled(
      letters.filter((letter) => letter !== answer),
    ).slice(0, 3);
    for (const letter of shuffled([answer, ...alternatives])) {
      const button = document.createElement("button");
      button.textContent = letter;
      button.onclick = () => {
        const correct = letter === answer;
        button.classList.add(correct ? "correct-answer" : "incorrect-answer");
        if (correct) {
          for (const option of group.children) option.disabled = true;
        } else {
          button.disabled = true;
          [...group.children].find((option) => !option.disabled)?.focus();
        }
        onAnswer(correct);
      };
      group.append(button);
    }
  }

  let question = "";
  function nextQuiz(focus) {
    question = shuffled(letters.filter((letter) => letter !== question))[0];
    $("quizCode").textContent = morseMarks(alphabet[question]);
    $("quizFeedback").textContent = "";
    $("quizNext").disabled = true;
    choices("quizOptions", question, (correct) => {
      $("quizFeedback").textContent = correct
        ? `Correct! That’s ${question}.`
        : "Try another letter.";
      if (correct) {
        $("quizNext").disabled = false;
        $("quizNext").focus();
      }
    });
    if (focus) $("quizOptions").firstElementChild.focus();
  }
  $("quizNext").onclick = () => nextQuiz(true);
  nextQuiz(false);

  const messages = ["SOS", "HELLO", "GOOD DAY", "HI THERE", "KEEP GOING"];
  let messageIndex = -1;
  let cursor = 0;
  function showChallenge(focus) {
    const message = messages[messageIndex];
    const complete = cursor === message.length;
    $("messageTiles").replaceChildren();
    for (const [index, letter] of Array.from(message).entries()) {
      const tile = document.createElement("span");
      tile.className = letter === " " ? "message-gap" : "message-tile";
      tile.textContent = letter === " " || index < cursor ? letter : "_";
      if (index === cursor) tile.classList.add("current-tile");
      $("messageTiles").append(tile);
    }
    $("challengeFeedback").textContent = complete
      ? `Message decoded! ${message}`
      : `${message.slice(0, cursor).replaceAll(" ", "").length} of ${message.replaceAll(" ", "").length} letters revealed`;
    $("challengeCode").textContent = complete
      ? ""
      : morseMarks(alphabet[message[cursor]]);
    if (complete) {
      $("challengeOptions").replaceChildren();
      $("challengeNext").focus();
      return;
    }
    choices("challengeOptions", message[cursor], (correct) => {
      if (!correct) {
        $("challengeFeedback").textContent = "Try another letter.";
        return;
      }
      cursor++;
      if (message[cursor] === " ") cursor++;
      showChallenge(true);
    });
    if (focus) $("challengeOptions").firstElementChild.focus();
  }
  function nextMessage(focus) {
    messageIndex = (messageIndex + 1) % messages.length;
    cursor = 0;
    showChallenge(focus);
  }
  $("challengeNext").onclick = () => nextMessage(true);
  nextMessage(false);
}
loadAlphabet();
