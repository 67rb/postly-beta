import { useEffect, useMemo, useRef, useState } from "react";
import { InteractionPanel } from "./InteractionPanel.jsx";
import { Workspace } from "./Workspace.jsx";
import { loadLocal, writeLocal, saveMedia, readMedia, pruneMedia, nextSlot, nextQuarter, scheduledDate } from "./local-data.js";
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, Check, CheckCircle2, ChevronDown, CircleHelp,
  Clock3, Code2, FileText, Filter, Hash, Image as ImageIcon,
  ChevronLeft, ChevronRight,
  Inbox, Link2, Menu, MessageCircle, MessageSquareText, MoreHorizontal,
  Moon, Plus, Search, Send, Settings2, Smile, Sparkles, Sprout, Tags, Unlink, UserRound,
  Upload, WandSparkles, X,
} from "lucide-react";
import { siBluesky, siInstagram, siThreads, siTiktok, siFacebook, siYoutube, siPinterest } from "simple-icons";
import { FaLinkedinIn } from "react-icons/fa6";

const templates = [
  {
    title: "Add your take to a post worth resharing",
    description: "Lend your voice to a creator's idea and let your audience see your perspective.",
    icon: "reshare",
  },
  {
    title: "The thing that nearly made you stop",
    description: "Many of us have had a stretch when carrying on with the work felt like too much. If you've been through one and feel ready to share it, your story will reach someone who's in that stretch right now.",
    icon: "lightbulb",
  },
  {
    title: "Ask your audience a strategic question",
    description: "One decision you're weighing, why you're asking, and where you're leaning before you ask.",
    icon: "question",
  },
  {
    title: "Question a habit everyone praises",
    description: "Challenge a routine or belief that gets praised in your industry.",
    icon: "clock",
  },
];

const blogPosts = [
  { title: "The Best Time to Post on TikTok in 2026: New Data from 7M Posts", image: "/assets/blog/tiktok.png", date: "Jul 20, 2026", slug: "best-time-to-post-on-tiktok" },
  { title: "13 Trending Sounds on Instagram (+ How to Use Them)", image: "/assets/blog/instagram-sounds.webp", date: "Aug 11, 2026", slug: "trending-audio-instagram" },
  { title: "How to Get More Followers on Instagram (13 Tried & Tested Tactics)", image: "/assets/blog/instagram-followers.png", date: "Aug 21, 2026", slug: "grow-on-instagram" },
  { title: "Best Time to Post on Instagram: New Data from 9.6 Million Posts", image: "/assets/blog/instagram-best-time.webp", date: "Jul 14, 2026", slug: "when-is-the-best-time-to-post-on-instagram" },
];

const defaultChannels = [
  { name: "Instagram", handle: "studio.notes", icon: siInstagram, color: "#e48b56" },
  { name: "TikTok", handle: "studio.notes", icon: siTiktok, color: "#f1f1f1" },
  { name: "YouTube", handle: "Clipper clip", icon: siYoutube, color: "#ec4036" },
];

const scheduleOptions = [
  { label: "Next Available", detail: "Use the next available posting slot in your queue." },
  { label: "Prioritize", detail: "Bump your post to the top of the queue." },
  { label: "Now", detail: "Publish your post right away." },
  { label: "Set Date and Time", detail: "Choose a specific time to post, or use our recommendation." },
];

function BrandMark({ size = 20 }) {
  return <span aria-hidden="true" className="postly-mark" style={{ width: size, height: size, fontSize: size * 0.72 }}>P</span>;
}

function SocialMark({ icon, brand: Brand, color, size = 17 }) {
  if (Brand) return <Brand aria-hidden="true" size={size} color={color} className="social-mark" />;
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" className="social-mark" style={{ color }}><path fill="currentColor" d={icon.path} /></svg>;
}

function TemplateIcon({ name }) {
  if (name === "reshare") return <Link2 size={18} />;
  if (name === "lightbulb") return <Sparkles size={18} />;
  if (name === "question") return <MessageCircle size={18} />;
  return <Clock3 size={18} />;
}

function ChannelAvatar({ channel, active, onClick }) {
  return (
    <button className={`channel-avatar ${active ? "selected" : ""}`} onClick={onClick} title={`${active ? "Deselect" : "Select"} ${channel.name}`} aria-label={`${active ? "Deselect" : "Select"} ${channel.name} ${channel.handle}`} aria-pressed={active}>
      <span className="profile-avatar"><UserRound size={20} /></span>
      <span className="platform-badge"><SocialMark icon={channel.icon} brand={channel.brand} color={channel.color} size={11} /></span>
    </button>
  );
}

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const baseline = useRef(null);
  const [selectedChannels, setSelectedChannels] = useState([0, 1, 2]);
  const [postText, setPostText] = useState("");
  const [toolPanel, setToolPanel] = useState("");
  const [aiStep, setAiStep] = useState(0);
  const [aiOnboarded, setAiOnboarded] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [customize, setCustomize] = useState(false);
  const [activeChannel, setActiveChannel] = useState("Instagram");
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateTimeSet, setDateTimeSet] = useState(false);
  const [scheduleMode, setScheduleMode] = useState("Date & Time");
  const [selectedDate, setSelectedDate] = useState(nextQuarter);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedTime, setSelectedTime] = useState(() => nextQuarter().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }));
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateTab, setTemplateTab] = useState("Discover");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [records, setRecords] = useState(() => loadLocal("buffer-posts", []).filter(item => item && typeof item.id === "string" && typeof item.text === "string"));
  const [editingId, setEditingId] = useState(null);
  const [panel, setPanel] = useState("");
  const [organizationMenu, setOrganizationMenu] = useState(false);
  const [postMenu, setPostMenu] = useState(false);
  const [utilityMenu, setUtilityMenu] = useState("");
  const [connected, setConnected] = useState(() => loadLocal("buffer-channels", ["Instagram", "TikTok", "YouTube"]).filter(item => ["Instagram", "TikTok", "YouTube"].includes(item)));
  const [socialStatus, setSocialStatus] = useState({});
  const [personalTemplates, setPersonalTemplates] = useState(() => loadLocal("buffer-templates", []).filter(item => item && typeof item.title === "string" && typeof item.description === "string"));
  const [templateEditor, setTemplateEditor] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [socialOnly, setSocialOnly] = useState(true);
  const [disclosure, setDisclosure] = useState(false);
  const scheduledRecords = records.filter(record => record.status === "scheduled").sort((a, b) => (a.scheduleMode === "Prioritize" ? -1 : b.scheduleMode === "Prioritize" ? 1 : new Date(a.scheduleAt || a.createdAt) - new Date(b.scheduleAt || b.createdAt)));
  const scheduledPosts = scheduledRecords.length;
  const drafts = records.filter(record => record.status === "draft").length;
  const [doneSteps, setDoneSteps] = useState(() => loadLocal("buffer-done-steps", []));
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [createAnother, setCreateAnother] = useState(false);
  const [firstComment, setFirstComment] = useState(false);
  const [firstCommentText, setFirstCommentText] = useState("");
  const [productTags, setProductTags] = useState("");
  const [postTypes, setPostTypes] = useState({ Instagram: "Post", TikTok: "Video", YouTube: "Video" });
  const [postingMethods, setPostingMethods] = useState({});
  const [mediaPreviews, setMediaPreviews] = useState({});
  const [profiles, setProfiles] = useState(() => loadLocal("buffer-profiles", {}));
  const [organizationName, setOrganizationName] = useState(() => loadLocal("buffer-organization-name", "My organization"));
  const channels = [...defaultChannels.map(channel => ({ ...channel, handle: socialStatus[channel.name.toLowerCase()]?.profile || profiles[channel.name] || channel.handle })), ...connected.filter(name => !defaultChannels.some(channel => channel.name === name)).map(name => ({ name, handle: socialStatus[name.toLowerCase()]?.profile || profiles[name] || "studio.notes", icon: ({ Threads: siThreads, Bluesky: siBluesky, Facebook: siFacebook, YouTube: siYoutube, Pinterest: siPinterest })[name], brand: ["Threads", "Bluesky", "Facebook", "YouTube", "Pinterest"].includes(name) ? undefined : UserRound, color: "#c8c8c4" }))];
  useEffect(() => { writeLocal("buffer-profiles", profiles); }, [profiles]);
  useEffect(() => { writeLocal("buffer-organization-name", organizationName); }, [organizationName]);

  useEffect(() => { writeLocal("buffer-done-steps", doneSteps); }, [doneSteps]);
  useEffect(() => {
    const warn = () => setToast("Browser storage is full or unavailable. Your latest changes could not be saved.");
    window.addEventListener("buffer-storage-error", warn);
    return () => window.removeEventListener("buffer-storage-error", warn);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const urls = [];
    Promise.all(attachments.map(async attachment => [attachment.id, await readMedia(attachment.id).catch(() => null)])).then(items => {
      if (cancelled) return;
      const previews = {};
      for (const [id, blob] of items) if (blob) { const url = URL.createObjectURL(blob); previews[id] = url; urls.push(url); }
      setMediaPreviews(previews);
    });
    return () => { cancelled = true; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [attachments]);

  const snapshot = JSON.stringify({ postText, uploadedFiles, selectedChannels, firstComment, firstCommentText, productTags, disclosure, postTypes, postingMethods, scheduleMode, dateTimeSet, selectedTime, day: selectedDate.toDateString() });
  const dirty = composerOpen && baseline.current !== null && baseline.current !== snapshot && Boolean(postText.trim() || uploadedFiles.length);
  useEffect(() => { if (composerOpen && baseline.current === null) baseline.current = snapshot; });
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  useEffect(() => {
    const keep = new Set([...records.flatMap(record => record.attachments || []), ...attachments].map(item => item.id));
    pruneMedia(keep).catch(() => {});
  }, [records, attachments]);

  const filteredTemplates = useMemo(() => (templateTab === "Personal" || savedOnly ? personalTemplates : socialOnly ? templates : []).filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(templateQuery.toLowerCase())), [templateQuery, templateTab, personalTemplates, savedOnly, socialOnly]);
  useEffect(() => { writeLocal("buffer-posts", records); }, [records]);
  useEffect(() => { writeLocal("buffer-channels", connected); }, [connected]);
  useEffect(() => {
    const refreshAccounts = () => fetch("/api/social/status").then(response => response.ok ? response.json() : null).then(data => { if (data?.providers) setSocialStatus(data.providers); }).catch(() => {});
    refreshAccounts();
    window.addEventListener("focus", refreshAccounts);
    return () => window.removeEventListener("focus", refreshAccounts);
  }, []);
  useEffect(() => { writeLocal("buffer-templates", personalTemplates); }, [personalTemplates]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("connected");
    const error = params.get("social_error");
    if (provider) setToast(`${({ instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" })[provider] || "Social"} account connected`);
    if (error) setToast(error === "authorization_denied" ? "Account connection was cancelled" : "Account connection did not finish. Check the developer app settings.");
    if (provider || error) window.setTimeout(() => setToast(""), 4200);
    if (provider || error) window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
  }, []);
  useEffect(() => {
    const dismiss = event => {
      if (!event.target.closest("[data-popover]")) { setOrganizationMenu(false); setPostMenu(false); setUtilityMenu(""); setFilterOpen(false); setNewMenuOpen(false); }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  useEffect(() => {
    const escape = event => {
      if (event.key !== "Escape") return;
      if (discardOpen) setDiscardOpen(false);
      else if (panel) setPanel("");
      else if (templateEditor) setTemplateEditor(false);
      else if (datePickerOpen) { setDatePickerOpen(false); setScheduleMenuOpen(false); }
      else if (utilityMenu || organizationMenu || postMenu || filterOpen || newMenuOpen) { setUtilityMenu(""); setOrganizationMenu(false); setPostMenu(false); setFilterOpen(false); setNewMenuOpen(false); }
      else if (composerOpen) requestCloseComposer();
      else setSidebarOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [panel, templateEditor, datePickerOpen, utilityMenu, organizationMenu, postMenu, filterOpen, newMenuOpen, composerOpen, discardOpen, dirty]);
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - firstDay.getDay());
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [calendarMonth]);
  const scheduleLabel = scheduleMode === "Date & Time"
    ? dateTimeSet ? `${selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${selectedTime}` : "Date & Time"
    : scheduleMode;
  const effectiveMode = scheduleMode === "Date & Time" && !dateTimeSet ? "Next Available" : scheduleMode;
  const chosenDate = scheduledDate(selectedDate, selectedTime);
  const dateError = dateTimeSet && (scheduleMode === "Date & Time" || datePickerOpen) ? !chosenDate ? "Enter a valid time, such as 10:30 AM." : chosenDate.getTime() <= Date.now() ? "Choose a date and time in the future." : "" : "";
  const postError = postText.length > 2200 ? "This post exceeds the 2,200 character limit." : !selectedChannels.length ? "Select at least one channel." : dateError;
  const scheduledAt = effectiveMode === "Now" ? null : effectiveMode === "Date & Time" ? chosenDate : effectiveMode === "Prioritize" ? new Date(Date.now() + 60000) : nextSlot();
  const scheduleSummary = effectiveMode === "Now" ? "Published locally just now" : `${scheduledAt?.toLocaleDateString("en-US", { month: "short", day: "numeric" }) || ""} · ${scheduledAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) || ""}`;

  useEffect(() => {
    const surface = discardOpen ? document.querySelector(".discard-dialog") : panel ? document.querySelector(".interaction-dialog") : composerOpen ? document.querySelector(".composer-modal") : sidebarOpen ? document.querySelector(".sidebar") : null;
    if (!surface) return;
    const previous = document.activeElement;
    const controls = () => [...surface.querySelectorAll('button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]')].filter(element => element.getClientRects().length && !element.closest('[inert]'));
    controls()[0]?.focus();
    const trap = event => {
      if (event.key !== "Tab") return;
      const elements = controls(), first = elements[0], last = elements.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [panel, composerOpen, sidebarOpen, discardOpen]);

  const notify = (message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  const openComposer = () => {
    baseline.current = null;
    setDiscardOpen(false);
    setSidebarOpen(false);
    setNewMenuOpen(false);
    setPostText("");
    setEditingId(null);
    setSelectedTemplate(null);
    setUploadedFiles([]);
    setAttachments([]);
    setFirstComment(false);
    setFirstCommentText("");
    setProductTags("");
    setMediaPreviews({});
    setDisclosure(false);
    setPostTypes({ Instagram: "Post", TikTok: "Video", YouTube: "Video" });
    setPostingMethods({});
    const next = nextQuarter();
    setSelectedDate(next);
    const defaultAction = loadLocal("postly-preferences", {})["Default Posting Action"] || "Date & Time";
    const hour12 = loadLocal("postly-preferences", {})["Time Format"] !== "24-hour";
    setSelectedTime(next.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12 }));
    setCalendarMonth(new Date(next.getFullYear(), next.getMonth(), 1)); setDateTimeSet(defaultAction === "Set Date and Time"); setScheduleMode(defaultAction === "Set Date and Time" ? "Date & Time" : defaultAction);
    setUtilityMenu("");
    setDatePickerOpen(false);
    setScheduleMenuOpen(false);
    setPanel("");
    setToolPanel("");
    setCustomize(false);
    setComposerOpen(true);
  };

  const closeComposer = () => {
    baseline.current = null;
    setDiscardOpen(false);
    setComposerOpen(false);
    setToolPanel("");
    setCustomize(false);
    setScheduleMenuOpen(false);
    setDatePickerOpen(false);
    setUtilityMenu("");
    setTemplateEditor(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("compose") === "1") {
      openComposer();
      if (params.get("template")) {
        setPostText(params.get("template"));
        setSelectedTemplate(params.get("template").split("\n")[0]);
      }
    }
    if (params.get("edit")) {
      const record = records.find(item => item.id === params.get("edit"));
      if (record) editPost(record);
    }
    if (params.get("panel")) setPanel(params.get("panel"));
  }, []);

  const requestCloseComposer = () => {
    if (isUploading) { notify("Wait for the media to finish saving."); return; }
    if (dirty) setDiscardOpen(true);
    else closeComposer();
  };

  const toggleChannel = (index) => {
    setSelectedChannels((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  };

  const chooseSchedule = (label) => {
    setScheduleMode(label === "Set Date and Time" ? "Date & Time" : label);
    setScheduleMenuOpen(false);
    if (label === "Set Date and Time") setDateTimeSet(true);
    setDatePickerOpen(label === "Set Date and Time");
  };

  const storePost = status => {
    const record = { id: editingId || crypto.randomUUID(), text: postText, files: uploadedFiles, attachments, scheduleMode: effectiveMode, scheduleAt: scheduledAt?.toISOString() || null, selectedTime, dateTimeSet, channels: selectedChannels, firstComment: firstComment ? firstCommentText : "", disclosure, productTags, postTypes, postingMethods, status, summary: status === "draft" ? "Saved draft" : scheduleSummary, createdAt: new Date().toISOString() };
    setRecords(current => [record, ...current.filter(item => item.id !== record.id)]);
    return record;
  };
  const editPost = record => {
    baseline.current = null;
    setPanel(""); setPostMenu(false); setSidebarOpen(false); setToolPanel(""); setCustomize(false); setDatePickerOpen(false);
    if (!record) return openComposer();
    setEditingId(record.id); setPostText(record.text); setUploadedFiles(record.files || []); setAttachments(record.attachments || []); setSelectedChannels(record.channels || [0, 1, 2]); setSelectedTemplate(null); setFirstComment(Boolean(record.firstComment)); setFirstCommentText(record.firstComment || ""); setDisclosure(Boolean(record.disclosure)); setProductTags(record.productTags || ""); setPostTypes(record.postTypes || { Instagram: "Post", TikTok: "Video", YouTube: "Video" }); setPostingMethods(record.postingMethods || {});
    const restoredDate = record.scheduleAt && Number.isFinite(Date.parse(record.scheduleAt)) ? new Date(record.scheduleAt) : nextQuarter();
    setSelectedDate(restoredDate); setCalendarMonth(new Date(restoredDate.getFullYear(), restoredDate.getMonth(), 1));
    setSelectedTime(record.selectedTime || restoredDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }));
    setScheduleMode(record.scheduleMode || "Date & Time"); setDateTimeSet(Boolean(record.dateTimeSet)); setComposerOpen(true);
  };
  const deletePost = id => { setRecords(current => current.filter(item => item.id !== id)); setPostMenu(false); notify("Post deleted"); };
  const schedulePost = () => {
    if ((!postText.trim() && !uploadedFiles.length) || postError || isUploading) return;
    storePost(scheduleMode === "Now" ? "published" : "scheduled");
    notify(scheduleMode === "Now" ? "Post saved as published in this demo" : "Post added to your local queue");
    if (createAnother) { setEditingId(null); setPostText(""); setUploadedFiles([]); setAttachments([]); setSelectedTemplate(null); setToolPanel(""); setCustomize(false); }
    else closeComposer();
  };
  const saveDraft = () => {
    if (isUploading || (!postText.trim() && uploadedFiles.length === 0)) return;
    storePost("draft"); notify("Draft saved locally"); closeComposer();
  };

  const useTemplate = (item) => {
    setSelectedTemplate(item.title);
    setPostText(`${item.title}\n\n${item.description}`);
    setToolPanel("");
    setCustomize(false);
  };

  const markStep = (index) => setDoneSteps((current) => current.includes(index) ? current.filter((step) => step !== index) : [...current, index]);

  const sidebarAction = (label) => {
    setSidebarOpen(false);
    if (label === "Create" || label === "Post") return openComposer();
    const routes = { Home: "/home", Publish: "/schedule", Community: "/community/posts", Insights: "/insights" };
    if (routes[label]) window.location.assign(routes[label]);
    else setPanel(label);
  };

  const changeFiles = async event => {
    const files = Array.from(event.target?.files || event.dataTransfer?.files || []);
    if (event.target?.type === "file") event.target.value = "";
    if (!files.length) return;
    if (files.some(file => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) { notify("Choose image or video files."); return; }
    setIsUploading(true);
    try {
      const saved = await Promise.all(files.map(saveMedia));
      setAttachments(current => [...current, ...saved]);
      setUploadedFiles(current => [...current, ...saved.map(file => file.name)]);
    } catch { notify("Could not save the media. Check available browser storage and try again."); }
    finally { setIsUploading(false); }
  };
  const removeFile = index => {
    setUploadedFiles(current => current.filter((_, position) => position !== index));
    setAttachments(current => current.filter((_, position) => position !== index));
  };
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good Morning" : now.getHours() < 18 ? "Good Afternoon" : "Good Evening";

  const routeParams = new URLSearchParams(window.location.search);
  if (!["/", "/home"].includes(window.location.pathname) || (!routeParams.has("compose") && !routeParams.has("panel") && !routeParams.has("edit"))) {
    return <Workspace
      path={["/", "/home"].includes(window.location.pathname) ? "/home" : window.location.pathname}
      organizationName={organizationName}
      onOrganizationChange={setOrganizationName}
      connected={connected}
      socialStatus={socialStatus}
      records={records}
      onDelete={deletePost}
      scheduledCount={scheduledPosts}
      onCompose={() => window.location.assign("/home?compose=1")}
      onConnect={() => window.location.assign("/home?panel=Connect%20Channel")}
    />;
  }

  return (
    <div className="app-shell">
      <input id="media-upload" type="file" accept="image/*,video/*" multiple hidden onChange={changeFiles} />
      <header className="topbar" inert={Boolean(panel || composerOpen || sidebarOpen)}>
        <div className="topbar-left">
          <button className="icon-button top-menu" aria-label="Open menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <button className="brand-lockup" onClick={() => sidebarAction("Home")} aria-label="Postly home"><BrandMark size={20} /><span>Postly</span></button>
        </div>
        <button className="streak-button" onClick={() => notify("Your weekly posting streak starts with your first post")}><Sprout size={18} /><span className="streak-count">0</span></button>
      </header>

      <main className="dashboard" inert={Boolean(panel || composerOpen || sidebarOpen)}>
        <div className="welcome-row">
          <div className="welcome-left">
            <div className="weather-icon"><Moon size={21} fill="currentColor" strokeWidth={1.5} /></div>
            <div><h1>{greeting}, creator!</h1><p>{now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p></div>
          </div>
          <div className="welcome-actions">
            <button className="icon-button subtle" aria-label="Share Feedback" onClick={() => setPanel("Share Feedback")}><MessageSquareText size={17} /></button>
            <button className="sync-status" aria-label="About sync status" onClick={() => notify("All channels are synced")}><span className="sync-dot"><Check size={11} /></span></button>
          </div>
        </div>

        <section className="scorecard" aria-label="Your scorecard">
          <div className="score-item">
            <div className="score-ring">0</div>
            <strong>Week Streak <button className="tiny-info" aria-label="About Week Streak" onClick={() => notify("Your streak grows when you post each week")}><CircleHelp size={14} /></button></strong>
            <button className="score-link" onClick={() => notify("Start your streak by scheduling a post")}>Start your streak today</button>
          </div>
          <div className="score-item">
            <div className="score-ring">0</div>
            <strong>Posting Goals <button className="tiny-info" aria-label="About Posting Goals" onClick={() => notify("Your weekly goals will show here")}><CircleHelp size={14} /></button></strong>
            <span>No goals met yet</span>
          </div>
          <div className="score-item">
            <div className="score-ring">0</div>
            <strong>Comment Score <button className="tiny-info" aria-label="About Comment Score" onClick={() => notify("Your community activity will show here")}><CircleHelp size={14} /></button></strong>
            <span>Holding steady</span>
          </div>
        </section>

        <section className="first-steps-section">
          <h2>First Steps</h2>
          <div className="steps-list">
            {[
              { title: "Connect a channel", description: "Authorize a social account to connect it to Postly.", action: "Connect Channel", handler: () => setPanel("Connect Channel") },
              { title: "Create a post", description: "Schedule your first post in just a few clicks.", action: "Create Post", handler: openComposer },
              { title: "Explore Postly API", description: "Connect to your agents, automation tools, and more.", action: "Get Started", handler: () => setPanel("Explore Postly API") },
            ].map((step, index) => (
              <article className={`step-card ${doneSteps.includes(index) ? "step-done" : ""}`} key={step.title}>
                <button className="step-check" aria-label={doneSteps.includes(index) ? "Mark as not done" : "Mark as done"} aria-pressed={doneSteps.includes(index)} onClick={() => markStep(index)}><CheckCircle2 size={17} /></button>
                <div className="step-copy"><h3>{index + 1}. {step.title}</h3><p>{step.description}</p></div>
                <button className="outline-action" onClick={step.handler}>{index === 0 ? <Plus size={16} /> : index === 1 ? <FileText size={16} /> : <Code2 size={15} />}{step.action}</button>
              </article>
            ))}
          </div>
        </section>

        <div className="activity-grid">
          <section className="activity-section">
            <div className="section-heading"><h2>Up Next</h2><span className="count-badge">· &nbsp;{scheduledPosts} posts scheduled</span><button className="text-icon-button" aria-label="View all scheduled posts" onClick={() => setPanel("Publish")}><ArrowUpRight size={16} /></button></div>
            <div className={`empty-card ${scheduledPosts ? "has-post" : ""}`}>
              {scheduledPosts ? <><div className="empty-icon"><CalendarDays size={19} /></div><div className="empty-copy"><strong>{scheduledRecords[0]?.text || "Media post"}</strong><span>{scheduledRecords[0]?.summary}</span></div><div className="post-menu-wrap" data-popover><button className="more-button" aria-label="More post options" aria-haspopup="menu" aria-expanded={postMenu} onClick={() => setPostMenu(value => !value)}><MoreHorizontal size={18} /></button>{postMenu && <div className="post-options-menu popup-menu" role="menu"><button role="menuitem" onClick={() => editPost(scheduledRecords[0])}>Edit post</button><button role="menuitem" onClick={() => { const post = scheduledRecords[0]; setRecords(current => [{ ...post, id: crypto.randomUUID(), status: "draft", summary: "Saved draft" }, ...current]); setPostMenu(false); notify("Copied to drafts"); }}>Copy to drafts</button><button role="menuitem" onClick={() => deletePost(scheduledRecords[0].id)}>Delete post</button></div>}</div></> : <><div className="empty-copy"><strong>No posts scheduled yet.</strong><span>You'll see upcoming posts here.</span></div><button className="small-action" onClick={openComposer}><Plus size={15} />Create Post</button></>}
            </div>
          </section>
          <section className="activity-section">
            <div className="section-heading"><h2>Comments</h2><span className="count-badge">· &nbsp;0 unanswered</span><button className="text-icon-button" aria-label="View all comments" onClick={() => setPanel("Comments")}><ArrowUpRight size={16} /></button></div>
            <div className="empty-card">
              <div className="empty-copy"><strong>No comments yet.</strong><span>You'll see the latest posts here.</span></div>
              <button className="small-action" onClick={() => sidebarAction("Community")}><MessageCircle size={15} />Community</button>
            </div>
          </section>
        </div>

        <section className="templates-section">
          <div className="section-heading"><h2>Templates</h2><button className="view-all" onClick={() => { setToolPanel("templates"); setComposerOpen(true); }}>View all <ArrowUpRight size={15} /></button></div>
          <div className="template-grid">
            {templates.map((item) => <button className="template-card" key={item.title} onClick={() => { setPostText(`${item.title}\n\n${item.description}`); setSelectedTemplate(item.title); setComposerOpen(true); }}>
              <span className="template-icon"><TemplateIcon name={item.icon} /></span><h3>{item.title}</h3><p>{item.description}</p>
            </button>)}
          </div>
        </section>

        <section className="blog-section" id="blog">
          <div className="section-heading"><h2>From the Blog</h2><a className="view-all" href="https://buffer.com/resources/" target="_blank" rel="noreferrer">View All Articles <ArrowUpRight size={15} /></a></div>
          <div className="blog-grid">
            {blogPosts.map((post) => <a key={post.title} className="blog-card" href={`https://buffer.com/resources/${post.slug}/`} target="_blank" rel="noreferrer"><img className="blog-thumb" src={post.image} alt={post.title} /><div className="blog-meta"><span className="blog-label">Blog post</span><time>{post.date}</time></div><span className="blog-title">{post.title}</span><ArrowRight size={16} className="blog-arrow" /></a>)}
          </div>
        </section>
      </main>

      <button inert={Boolean(panel || composerOpen || sidebarOpen)} className="help-button" aria-label="Help center" onClick={() => setPanel("Help center") }><CircleHelp size={20} /></button>

      {sidebarOpen && <>
        <button className="scrim sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />
        <aside inert={Boolean(panel || composerOpen)} className="sidebar" aria-label="Main navigation">
          <div className="sidebar-top"><button className="brand-lockup" onClick={() => sidebarAction("Home")}><BrandMark size={20} /><span>Postly</span></button><button className="icon-button" aria-label="Close menu" onClick={() => setSidebarOpen(false)}><X size={19} /></button></div>
          <div className="new-menu-wrap" data-popover><button className="new-button" aria-expanded={newMenuOpen} onClick={() => setNewMenuOpen((value) => !value)}><Plus size={17} />New <ChevronDown size={15} className={newMenuOpen ? "rotate" : ""} /></button>
            {newMenuOpen && <div className="new-menu" role="menu"><button onClick={openComposer}><FileText size={16} /><span><b>Post</b><small>Publish content to a channel</small></span></button><button onClick={() => { setNewMenuOpen(false); setSidebarOpen(false); setPanel("Idea"); }}><Sparkles size={16} /><span><b>Idea</b><small>Capture a content idea</small></span></button><button onClick={() => setPanel("Connect Channel")}><Plus size={16} /><span><b>Connect a New Channel</b></span></button><button onClick={() => setPanel("Create a Start Page")}><Link2 size={16} /><span><b>Create a Start Page</b></span></button><button onClick={() => setPanel("Invite a Team Member")}><Send size={16} /><span><b>Invite a Team Member</b></span></button></div>}
          </div>
          <nav className="side-nav">
            <button className="active" onClick={() => sidebarAction("Home")}><Inbox size={17} />Home</button>
            <button onClick={() => sidebarAction("Create")}><FileText size={17} />Create</button>
            <button onClick={() => sidebarAction("Publish")}><CalendarDays size={17} />Publish<span className="nav-count">{scheduledPosts}</span></button>
            <button onClick={() => sidebarAction("Community")}><MessageCircle size={17} />Community</button>
            <button onClick={() => sidebarAction("Insights")}><BarChart3 size={17} />Insights</button>
          </nav>
          <div className="channel-list"><div className="side-section-title">CHANNELS <button aria-label="Add channel" onClick={() => setPanel("Connect Channel")}><Plus size={15} /></button></div>
            {channels.map((channel) => <button className="connected-channel" key={channel.name} onClick={() => setPanel("Publish")}><span className="small-social"><SocialMark icon={channel.icon} brand={channel.brand} color={channel.color} size={14} /></span><span>{channel.name}</span><span aria-label={socialStatus[channel.name.toLowerCase()]?.connected ? "Account connected" : "Account not connected"} className={socialStatus[channel.name.toLowerCase()]?.connected ? "online-dot" : "offline-dot"} /></button>)}
            <div className="connect-label">Connect more channels</div>
            {[{ name: "Threads", icon: siThreads }, { name: "LinkedIn", brand: FaLinkedinIn }, { name: "Bluesky", icon: siBluesky }].map((item) => <button className="connect-channel" key={item.name} onClick={() => setPanel("Connect Channel")}><span className="small-social"><SocialMark icon={item.icon} brand={item.brand} color="#d9d9d9" size={14} /></span>{item.name}<Plus size={14} /></button>)}
            <button className="more-channels" onClick={() => setPanel("Connect Channel")}>More channels <ChevronDown size={14} /></button>
          </div>
          <div className="organization-wrap" data-popover><button className="organization" aria-label="Organization menu" aria-haspopup="menu" aria-expanded={organizationMenu} onClick={() => setOrganizationMenu(value => !value)}><span className="org-avatar">S</span><span><b>{organizationName}</b><small>Free Plan</small></span><MoreHorizontal size={17} /></button>{organizationMenu && <div className="organization-menu popup-menu" role="menu">{["Organization settings", "Manage channels", "Drafts", "Help center"].map(title => <button role="menuitem" key={title} onClick={() => { setOrganizationMenu(false); setPanel(title); }}>{title}{title === "Drafts" ? ` (${drafts})` : ""}</button>)}</div>}</div>
        </aside>
      </>}

      {composerOpen && <>
        <button className="scrim composer-scrim" aria-label="Close composer overlay" onClick={requestCloseComposer} />
        <section inert={Boolean(panel)} className="composer-modal" role="dialog" aria-modal="true" aria-label="Create Post">
          <header className="composer-header" inert={discardOpen}><div><h2>Create Post</h2><p>Create and edit posts</p></div><div className="composer-tools">
              <button className={`composer-tool ${toolPanel === "templates" ? "tool-active" : ""}`} title="Templates" aria-label="Templates" onClick={() => { setToolPanel(toolPanel === "templates" ? "" : "templates"); setCustomize(false); }}><FileText size={17} /></button>
              <button className={`composer-tool ${toolPanel === "ai" ? "tool-active" : ""}`} title="AI Assistant" aria-label="AI Assistant" onClick={() => { if (toolPanel === "ai") setToolPanel(""); else { setToolPanel("ai"); setAiStep(aiOnboarded ? 4 : 0); setAiReady(aiOnboarded); setCustomize(false); } }}><WandSparkles size={17} /></button>
              <button className={`composer-tool ${toolPanel === "preview" ? "tool-active" : ""}`} title="Preview" aria-label="Preview" onClick={() => { setToolPanel(toolPanel === "preview" ? "" : "preview"); setCustomize(false); }}><ImageIcon size={17} /></button>
              <button className="icon-button" title="Close Composer" aria-label="Close Composer" onClick={requestCloseComposer}><X size={19} /></button>
            </div>
          </header>

          <div inert={discardOpen} className={`composer-main ${toolPanel ? "with-panel" : ""}`}>
              <div className="editor-column">
                <div className="channel-picker"><span className="field-label">Select channels</span><div className="channel-picker-list">{channels.map((channel, index) => <ChannelAvatar key={channel.name} channel={channel} active={selectedChannels.includes(index)} onClick={() => toggleChannel(index)} />)}<button className="add-channel-button" aria-label="Add channel" onClick={() => setPanel("Connect Channel")}><Plus size={17} /></button></div></div>
                {customize ? <div className="customize-panel" data-popover>
                  <div className="customize-title"><div><h3>Customize for each channel</h3><p>Adjust settings for your selected channels.</p></div><button className="icon-button" aria-label="Close channel customization" onClick={() => setCustomize(false)}><X size={17} /></button></div>
                  <div className="customize-tabs">{channels.filter((channel, index) => selectedChannels.includes(index)).map((channel) => <button key={channel.name} className={activeChannel === channel.name ? "current" : ""} onClick={() => setActiveChannel(channel.name)}><SocialMark icon={channel.icon} brand={channel.brand} color={channel.color} size={14} />{channel.name}</button>)}</div>
                  <div className="customize-content">
                    <label className="setting-label">Post type</label><div className="radio-row">{(activeChannel === "Instagram" ? ["Post", "Reel", "Story"] : activeChannel === "TikTok" ? ["Video", "Photo"] : ["Post"]).map((type, index) => <label key={type} className="radio-option"><input type="radio" name="post-type" checked={(postTypes[activeChannel] || (activeChannel === "TikTok" ? "Video" : "Post")) === type} onChange={() => setPostTypes(current => ({ ...current, [activeChannel]: type }))} />{type}</label>)}</div>
                    <div className="media-placeholder"><Upload size={18} /><span>Add media for {activeChannel}</span><button onClick={() => document.getElementById("media-upload")?.click()}>Upload media</button></div>
                    {activeChannel === "Instagram" && <><button className="setting-row" onClick={() => setUtilityMenu(utilityMenu === "music" ? "" : "music")}><span>Music</span><Plus size={15} /></button><button className="setting-row" onClick={() => setUtilityMenu(utilityMenu === "products" ? "" : "products")}><span>Tag Products</span><Plus size={15} /></button></>}
                    {utilityMenu === "music" && <div className="setting-expansion">Add a video with its audio track using Upload media.</div>}{utilityMenu === "products" && <label className="setting-expansion">Product names or links<input aria-label="Product tags" value={productTags} onChange={event => setProductTags(event.target.value)} placeholder="Add product names or links" /></label>}<div className="setting-block"><label className="setting-label">Posting method</label><select value={postingMethods[activeChannel] || "Automatic"} onChange={event => setPostingMethods(current => ({ ...current, [activeChannel]: event.target.value }))}><option>Automatic</option><option>Notify Me</option></select><small>{postingMethods[activeChannel] === "Notify Me" ? "A reminder will prompt you to publish manually." : "Postly will post automatically for you."}</small></div>
                    <button className="setting-row" onClick={() => setFirstComment((value) => !value)}><span>First Comment</span><span className={`switch ${firstComment ? "on" : ""}`} /></button>
                    {firstComment && <textarea className="first-comment-input" aria-label="First comment" value={firstCommentText} onChange={event => setFirstCommentText(event.target.value)} placeholder="Write your first comment…" />}<button className="setting-row" onClick={() => setPanel("Invite a Team Member")}><span>Collaborators</span><Plus size={15} /></button>
                    <button className="setting-row" onClick={() => setDisclosure(value => !value)}><span>AI-Generated disclosure</span><span className={`switch ${disclosure ? "on" : ""}`} /></button>
                  </div>
                </div> : <>
                  <div className="editor-card">
                    {selectedTemplate && <div className="attached-template"><Tags size={13} />{selectedTemplate}<button aria-label="Remove template" onClick={() => setSelectedTemplate(null)}><X size={13} /></button></div>}
                    <textarea aria-label="composer textbox" placeholder="Start writing or get inspired with Templates" value={postText} onChange={(event) => setPostText(event.target.value)} />
                    <label className="upload-area" htmlFor="media-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); changeFiles(event); }}><Upload size={17} /><span>Drag &amp; drop or <b>select a file</b></span></label>
                    {uploadedFiles.length > 0 && <div className="file-list">{uploadedFiles.map((file, index) => <span key={`${file}-${index}`}><ImageIcon size={13} />{file}<button aria-label={`Remove ${file}`} onClick={() => removeFile(index)}><X size={12} /></button></span>)}</div>}
                    <div className="editor-utility-row" data-popover><button aria-label="More integration options" onClick={() => setUtilityMenu(utilityMenu === "integrations" ? "" : "integrations")}><MoreHorizontal size={18} /></button><button aria-label="Select emoji" onClick={() => setUtilityMenu(utilityMenu === "emoji" ? "" : "emoji")}><Smile size={17} /></button><button aria-label="Hashtag Manager" onClick={() => setPanel("Hashtag Manager")}><Hash size={17} /></button>{utilityMenu && <div className="integration-menu popup-menu" role="menu">{utilityMenu === "emoji" ? <div className="emoji-options">{["✨", "🙌", "💡", "❤️", "🎉", "👋", "🌱", "📣"].map(emoji => <button key={emoji} aria-label={`Insert ${emoji}`} onClick={() => { setPostText(value => value + emoji); setUtilityMenu(""); }}>{emoji}</button>)}</div> : utilityMenu === "music" ? <span className="menu-note">Upload a video with your chosen audio track.</span> : <><button role="menuitem" onClick={() => { document.getElementById("media-upload").click(); setUtilityMenu(""); }}>Upload media</button><button role="menuitem" onClick={() => { setPanel("Add a link"); setUtilityMenu(""); }}>Add a link</button><button role="menuitem" onClick={() => { setPanel("Hashtag Manager"); setUtilityMenu(""); }}>Hashtag Manager</button></>}</div>}<span className="character-count">{2200 - postText.length} &nbsp; · &nbsp;5 hashtags left</span></div>
                  </div>
                </>}
              </div>

              {toolPanel === "templates" ? <aside className="template-drawer">
                <div className="drawer-heading"><div><h3>Templates</h3><p>Find a starting point for your next post.</p></div><button className="icon-button" aria-label="Close templates" onClick={() => setToolPanel("")}><X size={17} /></button></div>
                <div className="template-tabs"><button className={templateTab === "Discover" ? "current" : ""} onClick={() => setTemplateTab("Discover")}>Discover</button><button className={templateTab === "Personal" ? "current" : ""} onClick={() => setTemplateTab("Personal")}>Personal</button></div>
                <label className="template-search" data-popover><Search size={15} /><input placeholder="Search templates" value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} /><button type="button" aria-label="Filter templates" onClick={() => setFilterOpen((value) => !value)}><Filter size={15} /></button></label>
                {filterOpen && <div className="filter-popover" data-popover><strong>Filter templates</strong><label><input type="checkbox" checked={socialOnly} onChange={event => setSocialOnly(event.target.checked)} /> Social posts</label><label><input type="checkbox" checked={savedOnly} onChange={event => setSavedOnly(event.target.checked)} /> Saved templates</label></div>}
                <button className="new-template-button" onClick={() => { setTemplateEditor(true); setTemplateName(""); setTemplateBody(""); }}><Plus size={15} />New Template</button>
                {templateEditor && <form className="template-editor" onSubmit={event => { event.preventDefault(); if (!templateName.trim() || !templateBody.trim()) return; setPersonalTemplates(current => [{ title: templateName.trim(), description: templateBody.trim(), icon: "question" }, ...current.filter(item => item.title !== templateName.trim())]); setTemplateTab("Personal"); setTemplateQuery(""); setSavedOnly(false); setTemplateEditor(false); }}><label>Template name<input required value={templateName} onChange={event => setTemplateName(event.target.value)} /></label><label>Post content<textarea required rows={4} value={templateBody} onChange={event => setTemplateBody(event.target.value)} /></label><div><button type="button" onClick={() => setTemplateEditor(false)}>Cancel</button><button type="submit">Save Template</button></div></form>}<div className="drawer-template-list">{filteredTemplates.map((item) => <button key={item.title} className={`drawer-template ${selectedTemplate === item.title ? "chosen" : ""}`} onClick={() => useTemplate(item)}><span className="template-icon"><TemplateIcon name={item.icon} /></span><span><b>{item.title}</b><small>{item.description}</small></span></button>)}{filteredTemplates.length === 0 && <p className="no-results">No templates match your search.</p>}</div>
              </aside> : toolPanel === "preview" ? <aside className="preview-panel"><div className="panel-title"><div><h3>Post Previews</h3></div></div>{postText.trim() || uploadedFiles.length ? selectedChannels.length ? selectedChannels.map(index => <article className="social-preview" key={index}><div className="preview-account"><span className="preview-avatar"><UserRound size={18}/></span><span><b>{channels[index].handle}</b><small>{channels[index].name} · Just now</small></span><SocialMark icon={channels[index].icon} brand={channels[index].brand} color={channels[index].color} size={15}/></div><p>{postText}</p>{uploadedFiles.map((file, index) => <div className="preview-media" key={index}>{mediaPreviews[attachments[index]?.id] ? attachments[index]?.type.startsWith("video/") ? <video controls src={mediaPreviews[attachments[index].id]} aria-label={file} /> : <img src={mediaPreviews[attachments[index].id]} alt={file} /> : <ImageIcon size={25}/>}<span>{file}</span></div>)}</article>) : <p className="no-results">Select a channel to preview your post.</p> : <div className="preview-empty"><ImageIcon size={25} /><p>See your post's preview here</p></div>}</aside> : toolPanel === "ai" ? <aside className="ai-panel"><div className="ai-panel-title"><WandSparkles size={15} /><h3>AI Assistant</h3></div>
                {aiStep < 4 ? <><h4 className="ai-step-title">{aiStep === 0 ? <>Hi, I'm your assistant <span className="source-emoji">👋</span></> : <>Useful things to know about me<ArrowDown size={15} /></>}</h4><div className="ai-step-card">{aiStep === 0 ? <><strong>I can help you:</strong><ul><li><WandSparkles size={13} />Write about any topic</li><li><FileText size={13} />Revise content</li><li><ArrowUpRight size={13} />Repurpose posts across networks</li></ul></> : aiStep === 1 ? <><div className="ai-brand-row"><SocialMark icon={siThreads} color="#a96ef4" size={34} /><SocialMark icon={siTiktok} color="#a96ef4" size={32} /><SocialMark icon={siInstagram} color="#a96ef4" size={32} /></div><p>I understand the channel you're posting to and will tailor my suggestions for that audience.</p></> : aiStep === 2 ? <><Unlink className="ai-step-icon" size={34} /><p>I don't have internet access and can't view any URLs you share.</p></> : <><AlertTriangle className="ai-step-icon" size={34} /><p>I sometimes, unintentionally, can share wrong or offensive information and have limited knowledge of events after Oct 2023.</p></>}</div><div className="ai-dots"><i className={aiStep === 0 ? "active" : ""} /><i className={aiStep === 1 ? "active" : ""} /><i className={aiStep === 2 ? "active" : ""} /><i className={aiStep === 3 ? "active" : ""} /></div><button className="ai-next" onClick={() => { if (aiStep < 3) setAiStep((value) => value + 1); else { setAiOnboarded(true); setAiStep(4); setAiReady(false); window.setTimeout(() => setAiReady(true), 900); } }}>{aiStep === 3 ? "Got It" : "Next"}</button></> : aiReady ? <div className="ai-ready"><label htmlFor="ai-prompt">What do you want to write about?</label><textarea id="ai-prompt" placeholder="Eg. Promote my photography course to get new signups. Registration closes in 3 days." value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} /><p><strong>Pro tip:</strong> Include key points, your target audience and your desired outcome for this post</p><button className="ai-generate" disabled={!aiPrompt.trim()} onClick={() => { setPostText(`Here’s a draft based on your idea:\n\n${aiPrompt.trim()}`); setToolPanel(""); notify("AI draft added to your post"); }}><WandSparkles size={15} />Generate</button><a href="https://support.buffer.com/articles/using-buffers-ai-assistant-qbBulfw9sn" target="_blank" rel="noreferrer"><CircleHelp size={14} />Learn more about <u>creating great prompts and the known limitations of AI.</u><ArrowUpRight size={13} /></a></div> : <div className="ai-loading">Setting things up</div>}</aside> : null}
          </div>

          <footer className="composer-footer" inert={discardOpen}>
            <div className="footer-top-row">{isUploading && <span role="status" className="composer-status">Saving media…</span>}{customize && postError && <span role="alert" className="composer-error">{postError}</span>}<label className="create-another"><input type="checkbox" checked={createAnother} onChange={(event) => setCreateAnother(event.target.checked)} />Create Another</label><button className="secondary-button" disabled={isUploading || (!postText.trim() && uploadedFiles.length === 0)} onClick={saveDraft}>Save Draft</button></div>
            <div className="footer-actions">
              <div className="schedule-wrap"><button className="schedule-select" aria-label="Choose date and time" aria-expanded={datePickerOpen} onClick={() => { setScheduleMenuOpen(false); setDateTimeSet(true); setDatePickerOpen((value) => !value); }}><CalendarDays size={16} />{scheduleLabel}<ChevronDown size={15} /></button></div>
              <button className="primary-button" disabled={isUploading || (customize && ((!postText.trim() && uploadedFiles.length === 0) || Boolean(postError)))} onClick={() => { if (customize) schedulePost(); else { setCustomize(true); setActiveChannel(channels[selectedChannels[0] ?? 0].name); setToolPanel(""); setUtilityMenu(""); } }}>{customize ? "Schedule Posts" : <>Customize <ArrowRight size={15} /></>}</button>
            </div>
          </footer>
          {datePickerOpen && <div inert={discardOpen} className="date-time-picker" role="dialog" aria-label="Schedule date and time">
            <div className="calendar-header"><h3>{calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3><div><button className="icon-button" aria-label="Previous month" disabled={calendarMonth.getFullYear() === new Date().getFullYear() && calendarMonth.getMonth() <= new Date().getMonth()} onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="Next month" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button></div></div>
            <div className="calendar-weekdays">{"SMTWTFS".split("").map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
            <div className="calendar-days">{calendarDays.map((day) => {
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const isCurrentMonth = day.getMonth() === calendarMonth.getMonth();
              const isSelected = day.toDateString() === selectedDate.toDateString();
              return <button key={day.toISOString()} type="button" disabled={day < today} className={`${isCurrentMonth ? "" : "outside-month"} ${isSelected ? "selected" : ""}`} onClick={() => setSelectedDate(new Date(day.getFullYear(), day.getMonth(), day.getDate()))}>{day.getDate()}</button>;
            })}</div>
            <div className="date-time-footer">
              <label htmlFor="schedule-time">Select Time</label>
              <div className="time-input-wrap"><Clock3 size={15} /><input id="schedule-time" aria-label="Select Time" value={selectedTime} onChange={(event) => setSelectedTime(event.target.value)} /></div>
              {dateError && <span className="composer-error" role="alert">{dateError}</span>}<span className="timezone-label">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
              <div className="date-picker-actions"><button className="more-posting-actions" onClick={() => setScheduleMenuOpen((value) => !value)}><ChevronLeft size={14} />More Posting Actions</button><button className="date-picker-done" disabled={Boolean(dateError)} onClick={() => { if (dateError) return; setDatePickerOpen(false); setScheduleMenuOpen(false); setDateTimeSet(true); setScheduleMode("Date & Time"); }}>Done</button></div>
            </div>
            {scheduleMenuOpen && <div className="date-time-actions-menu">{scheduleOptions.map((option) => <button key={option.label} onClick={() => chooseSchedule(option.label)} className={scheduleMode === (option.label === "Set Date and Time" ? "Date & Time" : option.label) ? "selected" : ""}><span>{option.label}</span><small>{option.detail}</small></button>)}</div>}
          </div>}
          {discardOpen && <div className="discard-layer"><button className="scrim" aria-label="Keep editing" onClick={() => setDiscardOpen(false)} /><section className="discard-dialog" role="alertdialog" aria-modal="true" aria-label="Unsaved post"><h3>Save your changes?</h3><p>Your post has unsaved changes.</p><div><button onClick={() => setDiscardOpen(false)}>Keep Editing</button><button onClick={closeComposer}>Discard Changes</button><button onClick={saveDraft}>Save Draft</button></div></section></div>}
        </section>
      </>}

      {panel && <InteractionPanel key={panel} title={panel} onClose={() => setPanel("")} posts={records} connected={connected} onSave={(title, value) => { if (title === "Organization settings") setOrganizationName(value); }} onConnect={(network, handle) => { setProfiles(current => ({ ...current, [network]: handle })); setConnected(current => current.includes(network) ? current : [...current, network]); notify(`${network} profile saved locally`); }} onEdit={editPost} onDelete={deletePost} onNotify={(value, insert) => insert ? setPostText(current => `${current}${current ? "\n" : ""}${value}`) : setPanel(value)} />}
      {toast && <div role="status" className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  );
}
