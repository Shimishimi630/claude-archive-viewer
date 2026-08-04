import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAsAvtHnTstPbu14Jj8aNcBS0Pd4ppYn6k",
  authDomain: "claude-archive-sync-504508.firebaseapp.com",
  projectId: "claude-archive-sync-504508",
  storageBucket: "claude-archive-sync-504508.firebasestorage.app",
  messagingSenderId: "753064784228",
  appId: "1:753064784228:web:5d2a8a4db10c4a23964a71",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const syncButton = document.getElementById("cloudSyncButton");
const syncStatus = document.getElementById("cloudSyncStatus");
const MAX_CHUNK_MESSAGES = 100;
const MAX_CHUNK_BYTES = 380 * 1024;
let currentUser = null;
let saveTimer = 0;
let saveInFlight = false;
const pendingRecords = new Map();

function setStatus(text, error = false) {
  syncStatus.textContent = text;
  syncStatus.classList.toggle("error", error);
}

function cleanMessage(message) {
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: String(message.content || ""),
    model: String(message.model || ""),
    error: String(message.error || ""),
  };
}

function splitMessages(messages) {
  const chunks = [];
  let current = [];
  let bytes = 2;
  for (const source of messages.slice(-3000)) {
    const message = cleanMessage(source);
    const size = new Blob([JSON.stringify(message)]).size + 1;
    if (current.length && (current.length >= MAX_CHUNK_MESSAGES || bytes + size > MAX_CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 2;
    }
    current.push(message);
    bytes += size;
  }
  if (current.length || !chunks.length) chunks.push(current);
  return chunks;
}

async function saveRecord(record) {
  if (!currentUser || !record?.id) return;
  const chatRef = doc(db, "apiChats", record.id);
  const chunks = splitMessages(record.messages || []);
  await setDoc(chatRef, {
    ownerId: currentUser.uid,
    title: String(record.title || "新聊天").slice(0, 80),
    titleGenerated: Boolean(record.titleGenerated),
    createdAt: Number(record.createdAt || record.updatedAt || Date.now()),
    updatedAt: Number(record.updatedAt || Date.now()),
    messageCount: Math.min(record.messages?.length || 0, 3000),
    chunkCount: chunks.length,
    deleted: false,
  });
  await Promise.all(chunks.map((messages, index) => setDoc(doc(chatRef, "chunks", String(index).padStart(4, "0")), {
    ownerId: currentUser.uid,
    index,
    messages,
  })));
  const existing = await getDocs(collection(chatRef, "chunks"));
  await Promise.all(existing.docs.filter((item) => Number(item.id) >= chunks.length).map((item) => deleteDoc(item.ref)));
}

async function deleteRecord(chatId) {
  if (!currentUser || !chatId) return;
  const chatRef = doc(db, "apiChats", chatId);
  await setDoc(chatRef, {
    ownerId: currentUser.uid,
    title: "",
    titleGenerated: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    chunkCount: 0,
    deleted: true,
  });
  const chunks = await getDocs(collection(chatRef, "chunks"));
  await Promise.all(chunks.docs.map((item) => deleteDoc(item.ref)));
}

async function flushPendingRecords() {
  if (!currentUser || saveInFlight || !pendingRecords.size) return;
  saveInFlight = true;
  const records = [...pendingRecords.values()];
  pendingRecords.clear();
  try {
    setStatus(records.length > 1 ? `正在同步 ${records.length} 个对话…` : "正在同步…");
    for (const record of records) await saveRecord(record);
    setStatus(`已同步 · ${currentUser.email}`);
  } catch (error) {
    for (const record of records) {
      if (!pendingRecords.has(record.id)) pendingRecords.set(record.id, record);
    }
    setStatus(`同步失败：${error.message}`, true);
  } finally {
    saveInFlight = false;
    if (currentUser && pendingRecords.size) {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(flushPendingRecords, 1200);
    }
  }
}

async function loadCloudHistory() {
  const snapshot = await getDocs(query(collection(db, "apiChats"), where("ownerId", "==", currentUser.uid)));
  const records = await Promise.all(snapshot.docs.map(async (chatDoc) => {
    const data = chatDoc.data();
    if (data.deleted) return { id: chatDoc.id, ...data, messages: [] };
    const chunks = await getDocs(collection(chatDoc.ref, "chunks"));
    const messages = chunks.docs
      .map((item) => item.data())
      .sort((a, b) => Number(a.index) - Number(b.index))
      .flatMap((item) => Array.isArray(item.messages) ? item.messages : []);
    return { id: chatDoc.id, ...data, messages };
  }));
  records.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  window.dispatchEvent(new CustomEvent("api-sync-load", { detail: records }));
}

async function login() {
  setStatus("正在打开 Google 登录…");
  await setPersistence(auth, browserLocalPersistence);
  if (matchMedia("(max-width: 700px)").matches) await signInWithRedirect(auth, provider);
  else await signInWithPopup(auth, provider);
}

syncButton.addEventListener("click", async () => {
  try {
    if (currentUser) await signOut(auth);
    else await login();
  } catch (error) {
    setStatus(`登录失败：${error.message}`, true);
  }
});

window.addEventListener("api-sync-save", (event) => {
  const record = event.detail;
  if (!record?.id) return;
  pendingRecords.set(record.id, record);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushPendingRecords, 900);
});

window.addEventListener("api-sync-delete", async (event) => {
  const chatId = typeof event.detail === "string" ? event.detail : event.detail?.id;
  pendingRecords.delete(chatId);
  try { await deleteRecord(chatId); } catch (error) { setStatus(`删除同步失败：${error.message}`, true); }
});

await setPersistence(auth, browserLocalPersistence);
await getRedirectResult(auth).catch((error) => setStatus(`登录失败：${error.message}`, true));
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  syncButton.textContent = user ? "退出同步账号" : "使用 Google 登录同步";
  if (!user) {
    setStatus("未登录 · 对话仅保存在这台设备");
    return;
  }
  setStatus("正在读取云端对话…");
  try {
    await loadCloudHistory();
    setStatus(`已同步 · ${user.email}`);
  } catch (error) {
    setStatus(`同步失败：${error.message}`, true);
  }
});
