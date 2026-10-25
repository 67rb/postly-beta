import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionPanel } from "./InteractionPanel.jsx";
import { Popover } from "./Popover.jsx";
import { Workspace } from "./Workspace.jsx";
import { applyPostAction, undoPostAction } from "./post-actions.js";
import { cancelScheduledDelivery, fetchScheduledDeliveryStatuses, registerScheduledDelivery, retryScheduledDelivery } from "./scheduled-delivery-client.js";
import { loadTemplates } from "./workspace-data.js";
import { calendarDateInTimezone, formatInTimezone, loadLocal, writeLocal, saveMedia, readMedia, pruneMedia, nextAvailableSlot, nextQuarter, resolveTimezone, scheduledDateInTimezone } from "./local-data.js";
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

const defaultTimezone = () => loadLocal("postly-preferences", {}).Timezone || "Johannesburg";
const clockOptions = (hour12 = true) => ({ hour: "numeric", minute: "2-digit", hourCycle: hour12 ? "h12" : "h23" });
const emptyChannelSchedule = timezone => ({ timezone, days: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(day => ({ day, enabled: true, times: ["9:00 AM"] })) });

const defaultChannels = [
  { id: "6abbdc0fea19ca0bde244c7e", name: "Instagram", handle: "Your Instagram", icon: siInstagram, color: "#e48b56" },
  { id: "6abbdb9eea19ca0bde244939", name: "TikTok", handle: "Your TikTok", icon: siTiktok, color: "#242424" },
  { id: "6abbdadbea19ca0bde24433e", name: "YouTube", handle: "Your YouTube", icon: siYoutube, color: "#ec4036" },
];
const providerForChannel = channel => ({ Instagram: "instagram", TikTok: "tiktok", YouTube: "youtube" })[channel?.name] || channel?.name?.toLowerCase() || "";
const channelIndexForResult = (result, channels) => {
  if (result.channelId) {
    const index = channels.findIndex(channel => channel.id === result.channelId);
    if (index >= 0) return index;
  }
  if (result.provider) {
    const index = channels.findIndex(channel => providerForChannel(channel) === result.provider.toLowerCase());
    if (index >= 0) return index;
  }
  return Number.isInteger(result.channelIndex) && result.channelIndex >= 0 ? result.channelIndex : -1;
};
const resultChannelName = result => result.channelName || ({ instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" })[result.provider] || result.provider || "Channel";

const scheduleOptions = [
  { label: "Next Available", detail: "Schedule this for the next selected channel slot." },
  { label: "Prioritize", detail: "Schedule this to send as soon as the Postly server can dispatch it." },
  { label: "Now", detail: "Try to publish immediately to connected accounts." },
  { label: "Set Date and Time", detail: "Choose when the Postly server should dispatch this post." },
];

const imageMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const tiktokPhotoTypes = new Set(["image/jpeg", "image/webp"]);
const videoMediaTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const supportedMediaTypes = new Set([...imageMediaTypes, ...videoMediaTypes]);
const mediaTypeHint = "Use JPEG, PNG, WebP, MP4, MOV, or WebM files.";

function validatePublishMedia(channelName, postType, attachments) {
  const files = attachments || [];
  const isImage = file => imageMediaTypes.has(file.type);
  const isVideo = file => videoMediaTypes.has(file.type);
  if (files.some(file => !supportedMediaTypes.has(file.type))) return mediaTypeHint;
  if (files.some(file => !file.size)) return "Remove empty files and upload them again.";

  if (channelName === "Instagram") {
    if (!files.length) return "Add at least one supported photo or video.";
    if (files.length > 10) return "Instagram supports up to 10 media items in a post.";
    if (files.length > 1 && postType !== "Post") return "Choose Post for an Instagram carousel.";
    if (files.length === 1 && isVideo(files[0]) && postType !== "Reel") return "Choose Reel for a single Instagram video.";
    if (files.length === 1 && isImage(files[0]) && postType !== "Post") return "Choose Post for a single Instagram photo.";
    return "";
  }

  if (channelName === "TikTok") {
    if (postType === "Video") {
      if (files.length !== 1) return "TikTok Video needs one video file.";
      return isVideo(files[0]) ? "" : "TikTok Video accepts MP4, MOV, or WebM video.";
    }
    if (postType === "Photo") {
      if (!files.length) return "TikTok Photo needs at least one photo.";
      if (files.length > 35) return "TikTok Photo supports up to 35 images.";
      if (files.some(file => !tiktokPhotoTypes.has(file.type))) return "TikTok Photo accepts JPEG or WebP images.";
      if (files.some(file => file.size > 20 * 1024 * 1024)) return "TikTok photos must be 20 MB or smaller each.";
      return "";
    }
    return "Choose Video or Photo for TikTok.";
  }

  if (channelName === "YouTube") {
    if (files.length !== 1) return "YouTube needs one video file.";
    return isVideo(files[0]) ? "" : "YouTube accepts MP4, MOV, or WebM video.";
  }

  return "";
}

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
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateTimeSet, setDateTimeSet] = useState(false);
  const [scheduleMode, setScheduleMode] = useState("Date & Time");
  const [scheduleTimezone, setScheduleTimezone] = useState(defaultTimezone);
  const [selectedDate, setSelectedDate] = useState(() => calendarDateInTimezone(nextQuarter(), defaultTimezone()));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = calendarDateInTimezone(new Date(), defaultTimezone());
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [startOfWeek, setStartOfWeek] = useState(() => loadLocal("postly-preferences", {})["Start of Week"] || "Sunday");
  const [selectedTime, setSelectedTime] = useState(() => formatInTimezone(nextQuarter(), clockOptions(true), defaultTimezone()));
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateTab, setTemplateTab] = useState("Discover");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [records, setRecords] = useState(() => loadLocal("buffer-posts", []).filter(item => item && typeof item.id === "string" && typeof item.text === "string"));
  const [postUndo, setPostUndo] = useState(() => {
    const saved = loadLocal("postly-post-undo", {});
    return saved.expiresAt > Date.now() && Array.isArray(saved.before) && Array.isArray(saved.after) ? saved : null;
  });
  const [editingId, setEditingId] = useState(null);
  const [panel, setPanel] = useState("");
  const [connectNetwork, setConnectNetwork] = useState("Instagram");
  const [organizationMenu, setOrganizationMenu] = useState(false);
  const [postMenu, setPostMenu] = useState(false);
  const [utilityMenu, setUtilityMenu] = useState("");
  const [connected, setConnected] = useState(() => loadLocal("buffer-channels", ["Instagram", "TikTok", "YouTube"]).filter(item => ["Instagram", "TikTok", "YouTube", "LinkedIn", "Threads", "Bluesky", "Facebook", "Pinterest"].includes(item)));
  const [socialStatus, setSocialStatus] = useState({});
  const refreshSocialStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/social/status");
      if (!response.ok) return;
      const data = await response.json();
      if (data?.providers) setSocialStatus(data.providers);
    } catch { /* Keep the current status when the local OAuth API is unavailable. */ }
  }, []);
  const [personalTemplates, setPersonalTemplates] = useState(loadTemplates);
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
  const [mediaDragging, setMediaDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [createAnother, setCreateAnother] = useState(false);
  const [firstComment, setFirstComment] = useState(false);
  const [firstCommentText, setFirstCommentText] = useState("");
  const [productTags, setProductTags] = useState("");
  const [postTypes, setPostTypes] = useState({ Instagram: "Post", TikTok: "Video", YouTube: "Video" });
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState("");
  const [tiktokCreatorInfo, setTiktokCreatorInfo] = useState(null);
  const [tiktokInfoLoading, setTiktokInfoLoading] = useState(false);
  const [tiktokInfoError, setTiktokInfoError] = useState("");
  const [tiktokAllowComments, setTiktokAllowComments] = useState(true);
  const [tiktokAllowDuet, setTiktokAllowDuet] = useState(true);
  const [tiktokAllowStitch, setTiktokAllowStitch] = useState(true);
  const [tiktokAutoAddMusic, setTiktokAutoAddMusic] = useState(true);
  const [youtubePrivacyStatus, setYoutubePrivacyStatus] = useState("private");
  const [postingMethods, setPostingMethods] = useState({});
  const [mediaPreviews, setMediaPreviews] = useState({});
  const [profiles, setProfiles] = useState(() => loadLocal("buffer-profiles", {}));
  const [organizationName, setOrganizationName] = useState(() => loadLocal("buffer-organization-name", "My organization"));
  const channels = [...defaultChannels.map(channel => ({ ...channel, handle: socialStatus[channel.name.toLowerCase()]?.profile || profiles[channel.name] || channel.handle })), ...connected.filter(name => !defaultChannels.some(channel => channel.name === name)).map(name => ({ name, handle: socialStatus[name.toLowerCase()]?.profile || profiles[name] || "studio.notes", icon: ({ Threads: siThreads, Bluesky: siBluesky, Facebook: siFacebook, YouTube: siYoutube, Pinterest: siPinterest })[name], brand: ["Threads", "Bluesky", "Facebook", "YouTube", "Pinterest"].includes(name) ? undefined : UserRound, color: "#c8c8c4" }))];
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const refreshScheduledDeliveryStatuses = useCallback(async () => {
    try {
      const jobs = await fetchScheduledDeliveryStatuses();
      const byPost = new Map();
      for (const job of jobs) byPost.set(job.postId, [...(byPost.get(job.postId) || []), job]);
      setRecords(current => current.map(record => {
        if (!record.scheduleAt || !["scheduled", "published"].includes(record.status)) return record;
        const serverJobs = byPost.get(record.id) || [];
        if (!serverJobs.length) return record;
        const previousByProvider = new Map((record.deliveryJobs || []).filter(item => item.provider).map(item => [item.provider, item]));
        const serverProviders = new Set(serverJobs.map(job => job.provider));
        const deliveryJobs = [
          ...serverJobs.map(job => {
            const activeChannels = channelsRef.current;
            const channelIndex = (record.channels || []).find(index => providerForChannel(activeChannels[index]) === job.provider);
            return { ...previousByProvider.get(job.provider), ...job, jobId: job.id, channelIndex, channelName: activeChannels[channelIndex]?.name || job.provider };
          }),
          ...(record.deliveryJobs || []).filter(item => !item.provider || !serverProviders.has(item.provider)),
        ];
        const publishedResults = deliveryJobs.filter(item => item.provider && item.status === "published").map(item => ({
          provider: item.provider,
          channelId: channelsRef.current[item.channelIndex]?.id || "",
          channelIndex: item.channelIndex,
          channelName: item.channelName,
          status: "published",
          remoteId: item.remoteId || "",
          publishId: item.publishId || "",
          error: "",
        }));
        const allChannelsPublished = (record.channels || []).length > 0 && record.channels.every(index => {
          const provider = providerForChannel(channelsRef.current[index]);
          return provider && deliveryJobs.some(item => item.provider === provider && item.status === "published");
        });
        const status = allChannelsPublished ? "published" : record.status;
        const publishResults = allChannelsPublished ? [...(record.publishResults || []).filter(item => item.status !== "published"), ...publishedResults] : record.publishResults;
        const summary = allChannelsPublished ? `Published to ${publishedResults.map(item => item.channelName).join(", ")}` : record.summary;
        if (JSON.stringify(record.deliveryJobs || []) === JSON.stringify(deliveryJobs) && record.status === status && JSON.stringify(record.publishResults || []) === JSON.stringify(publishResults || []) && record.summary === summary) return record;
        return { ...record, deliveryJobs, publishResults, status, summary, updatedAt: new Date().toISOString() };
      }));
    } catch { /* Keep cached per-channel status when the local scheduler API is unavailable. */ }
  }, []);
  useEffect(() => {
    if (!window.location.pathname.startsWith("/schedule") || !records.some(record => record.status === "scheduled")) return;
    refreshScheduledDeliveryStatuses();
    window.addEventListener("focus", refreshScheduledDeliveryStatuses);
    return () => window.removeEventListener("focus", refreshScheduledDeliveryStatuses);
  }, [refreshScheduledDeliveryStatuses]);
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

  const snapshot = JSON.stringify({ postText, uploadedFiles, selectedChannels, firstComment, firstCommentText, productTags, disclosure, postTypes, postingMethods, tiktokPrivacyLevel, youtubePrivacyStatus, tiktokAllowComments, tiktokAllowDuet, tiktokAllowStitch, tiktokAutoAddMusic, scheduleMode, dateTimeSet, selectedTime, timezone: scheduleTimezone, day: selectedDate.toDateString() });
  const dirty = composerOpen && baseline.current !== null && baseline.current !== snapshot && Boolean(postText.trim() || uploadedFiles.length);
  useEffect(() => { if (composerOpen && baseline.current === null) baseline.current = snapshot; });
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  useEffect(() => {
    const keep = new Set([...records.flatMap(record => record.attachments || []), ...(postUndo?.before || []).flatMap(record => record.attachments || []), ...attachments].map(item => item.id));
    pruneMedia(keep).catch(() => {});
  }, [records, attachments, postUndo]);
  useEffect(() => {
    writeLocal("postly-post-undo", postUndo || {});
    if (!postUndo) return;
    const timer = window.setTimeout(() => setPostUndo(null), Math.max(0, postUndo.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [postUndo]);

  const filteredTemplates = useMemo(() => (templateTab === "Personal" || savedOnly ? personalTemplates : socialOnly ? templates : []).filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(templateQuery.toLowerCase())), [templateQuery, templateTab, personalTemplates, savedOnly, socialOnly]);
  useEffect(() => { writeLocal("buffer-posts", records); }, [records]);
  useEffect(() => { writeLocal("buffer-channels", connected); }, [connected]);
  useEffect(() => {
    refreshSocialStatus();
    window.addEventListener("focus", refreshSocialStatus);
    return () => window.removeEventListener("focus", refreshSocialStatus);
  }, [refreshSocialStatus]);
  useEffect(() => { writeLocal("postly-templates", personalTemplates); }, [personalTemplates]);
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
      else if (datePickerOpen) setDatePickerOpen(false);
      else if (utilityMenu || organizationMenu || postMenu || filterOpen || newMenuOpen) { setUtilityMenu(""); setOrganizationMenu(false); setPostMenu(false); setFilterOpen(false); setNewMenuOpen(false); }
      else if (composerOpen) requestCloseComposer();
      else setSidebarOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [panel, templateEditor, datePickerOpen, utilityMenu, organizationMenu, postMenu, filterOpen, newMenuOpen, composerOpen, discardOpen, dirty]);
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const offset = (firstDay.getDay() - (startOfWeek === "Monday" ? 1 : 0) + 7) % 7;
    const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [calendarMonth, startOfWeek]);
  const scheduleToday = calendarDateInTimezone(new Date(), scheduleTimezone);
  const scheduleLabel = scheduleMode === "Date & Time"
    ? dateTimeSet ? `${selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${selectedTime}` : "Date & Time"
    : scheduleMode;
  const effectiveMode = scheduleMode === "Date & Time" && !dateTimeSet ? "Next Available" : scheduleMode;
  const chosenDate = scheduledDateInTimezone(selectedDate, selectedTime, scheduleTimezone);
  const channelSchedules = selectedChannels.map(index => {
    const channel = channels[index];
    const timezone = loadLocal("postly-preferences", {}).Timezone || "Johannesburg";
    return loadLocal(`postly-channel-schedule-${channel?.id || channel?.name?.toLowerCase() || `channel-${index}`}`, emptyChannelSchedule(timezone));
  });
  const scheduledAt = effectiveMode === "Now" ? null : effectiveMode === "Date & Time" ? chosenDate : effectiveMode === "Prioritize" ? new Date(Date.now() + 60000) : nextAvailableSlot(channelSchedules, scheduleTimezone);
  const dateError = dateTimeSet && (scheduleMode === "Date & Time" || datePickerOpen) ? !chosenDate ? "Enter a valid time, such as 10:30 AM." : chosenDate.getTime() <= Date.now() ? "Choose a date and time in the future." : "" : effectiveMode === "Next Available" && !scheduledAt ? "Add an available time to the selected channel schedule first." : "";
  const postError = postText.length > 2200 ? "This post exceeds the 2,200 character limit." : !selectedChannels.length ? "Select at least one channel." : dateError;
  const channelPublishChecks = selectedChannels.map(index => {
    const channel = channels[index];
    if (!channel) return { index, name: "Channel", error: "Select a valid channel." };
    const mediaError = validatePublishMedia(channel.name, postTypes[channel.name] || (channel.name === "TikTok" ? "Video" : "Post"), attachments);
    if (mediaError) return { index, name: channel.name, error: mediaError };
    const provider = ({ Instagram: "instagram", TikTok: "tiktok", YouTube: "youtube" })[channel.name];
    if (!provider) return { index, name: channel.name, error: `Live publishing is not available for ${channel.name} yet. This post can stay in the local queue.` };
    if (!socialStatus[provider]?.connected) return { index, name: channel.name, error: `Connect an authorized ${channel.name} account before publishing.` };
    if (channel.name === "TikTok" && (!tiktokCreatorInfo?.privacyLevelOptions?.includes(tiktokPrivacyLevel))) return { index, name: channel.name, error: "Choose one of the current TikTok audience options before publishing." };
    return { index, name: channel.name, error: "" };
  });
  const publishValidationErrors = [
    ...(postText.length > 2200 ? ["This post exceeds the 2,200 character limit."] : []),
    ...(selectedChannels.length ? channelPublishChecks.filter(item => item.error).map(item => `${item.name}: ${item.error}`) : ["Select at least one channel."]),
  ];
  const scheduleSummary = effectiveMode === "Now" ? "Publishes immediately to connected channels" : `${formatInTimezone(scheduledAt,{month:"short",day:"numeric"},scheduleTimezone)} · ${formatInTimezone(scheduledAt,clockOptions(loadLocal("postly-preferences", {})["Time Format"] !== "24-hour"),scheduleTimezone)}`;

  const shouldLoadTikTokInfo = customize && selectedChannels.some(index => channels[index]?.name === "TikTok") && Boolean(socialStatus.tiktok?.connected);
  useEffect(() => {
    if (!shouldLoadTikTokInfo) return;
    const controller = new AbortController();
    setTiktokCreatorInfo(null);
    setTiktokInfoError("");
    setTiktokInfoLoading(true);
    fetch("/api/social/tiktok/creator-info", { signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load TikTok posting options.");
        return data.creator;
      })
      .then(creator => {
        if (controller.signal.aborted) return;
        setTiktokCreatorInfo(creator || null);
        setTiktokPrivacyLevel(current => creator?.privacyLevelOptions?.includes(current) ? current : "");
      })
      .catch(error => { if (!controller.signal.aborted) setTiktokInfoError(error.message || "Could not load TikTok posting options."); })
      .finally(() => { if (!controller.signal.aborted) setTiktokInfoLoading(false); });
    return () => controller.abort();
  }, [shouldLoadTikTokInfo]);

  useEffect(() => {
    const surface = discardOpen ? document.querySelector(".discard-dialog") : panel ? document.querySelector(".interaction-dialog") : composerOpen ? document.querySelector(".composer-modal") : sidebarOpen ? document.querySelector(".sidebar") : null;
    if (!surface) return;
    const previous = document.activeElement;
    const controls = () => [...surface.querySelectorAll('button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]')].filter(element => element.getClientRects().length && !element.closest('[inert]'));
    const preferred = surface.matches(".composer-modal") ? surface.querySelector("#composer-copy") : null;
    (preferred || controls()[0])?.focus();
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

  useEffect(() => {
    if (!composerOpen && !panel) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [composerOpen, panel]);

  const notify = (message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  const openComposer = (options = {}) => {
    baseline.current = null;
    setDiscardOpen(false);
    setSidebarOpen(false);
    setNewMenuOpen(false);
    setPostText(options.text || "");
    setSelectedChannels(options.channels || [0, 1, 2]);
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
    setTiktokPrivacyLevel("");
    setTiktokCreatorInfo(null);
    setTiktokInfoError("");
    setTiktokAllowComments(true);
    setTiktokAllowDuet(true);
    setTiktokAllowStitch(true);
    setTiktokAutoAddMusic(true);
    setYoutubePrivacyStatus("private");
    setPublishError("");
    setPostingMethods({});
    const preferences = loadLocal("postly-preferences", {});
    const timezone = preferences.Timezone || "Johannesburg";
    setScheduleTimezone(timezone);
    setStartOfWeek(preferences["Start of Week"] || "Sunday");
    const requestedDate = options.date && new Date(options.date);
    const next = requestedDate && Number.isFinite(requestedDate.getTime()) ? requestedDate : nextQuarter();
    const calendarDate = calendarDateInTimezone(next, timezone);
    setSelectedDate(calendarDate);
    const defaultAction = preferences["Default Posting Action"] || "Date & Time";
    const hour12 = preferences["Time Format"] !== "24-hour";
    setSelectedTime(formatInTimezone(next, clockOptions(hour12), timezone));
    setCalendarMonth(new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1)); setDateTimeSet(Boolean(options.date) || defaultAction === "Set Date and Time"); setScheduleMode(options.date || defaultAction === "Set Date and Time" ? "Date & Time" : defaultAction);
    setUtilityMenu("");
    setDatePickerOpen(false);
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
    setDatePickerOpen(false);
    setUtilityMenu("");
    setTemplateEditor(false);
    const clean = new URL(window.location.href);
    ["compose", "template", "edit", "panel", "network"].forEach(key => clean.searchParams.delete(key));
    history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
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
    if (["Instagram","TikTok","YouTube"].includes(params.get("network"))) setConnectNetwork(params.get("network"));
  }, []);

  const requestCloseComposer = () => {
    if (isUploading || isPublishing) { notify(isPublishing ? "Wait for publishing to finish." : "Wait for the media to finish saving."); return; }
    if (dirty) setDiscardOpen(true);
    else closeComposer();
  };

  const toggleChannel = (index) => {
    const wasSelected = selectedChannels.includes(index);
    const next = wasSelected ? selectedChannels.filter(item => item !== index) : [...selectedChannels, index];
    setSelectedChannels(next);
    if (!wasSelected || (channels[index]?.name === activeChannel && next.length)) setActiveChannel(channels[next[0]]?.name || channels[index]?.name || "Instagram");
  };

  const chooseSchedule = (label) => {
    setScheduleMode(label === "Set Date and Time" ? "Date & Time" : label);
    if (label === "Set Date and Time") setDateTimeSet(true);
    setDatePickerOpen(label === "Set Date and Time");
  };

  const storePost = (status, options = {}) => {
    const id = editingId || crypto.randomUUID();
    const previous = records.find(item => item.id === id);
    const previousPublish = ["published", "publishing"].includes(previous?.status) ? previous : null;
    const channelsToStore = options.channels || selectedChannels;
    const newResults = options.publishResults || [];
    const sameResultChannel = (current, next) => current.channelId && next.channelId
      ? current.channelId === next.channelId
      : Boolean(current.provider && next.provider && current.provider === next.provider);
    const publishResults = status === "scheduled" ? [] : [...(previousPublish?.publishResults || []).filter(item => !newResults.some(result => sameResultChannel(item, result))), ...newResults];
    const finalStatus = status === "published"
      ? publishResults.some(item => item.status === "publishing") ? "publishing"
        : publishResults.some(item => item.status === "published") ? "published"
          : newResults.some(item => item.status === "failed") ? "draft" : status
      : status;
    const storedChannels = [...new Set([...(previousPublish?.channels || []), ...channelsToStore])];
    const successfulChannels = publishResults.filter(item => item.status === "published").map(item => item.privacyStatus === "private" && item.provider === "youtube" ? "YouTube privately" : resultChannelName(item));
    const failedChannels = newResults.filter(item => item.status === "failed").map(resultChannelName);
    const summary = finalStatus === "draft" && failedChannels.length ? `Could not publish to ${failedChannels.join(", ")}`
      : finalStatus === "draft" ? "Saved draft"
        : finalStatus === "publishing" ? "Sent to a channel; provider is still processing"
          : status === "published" && effectiveMode === "Now" ? `Published to ${successfulChannels.join(", ")}${failedChannels.length ? ` · Failed: ${failedChannels.join(", ")}` : ""}`
            : `Local queue · ${scheduleSummary}`;
    const record = { id, text: postText, files: uploadedFiles, attachments, scheduleMode: effectiveMode, scheduleAt: status === "scheduled" ? scheduledAt?.toISOString() || null : null, selectedTime, timezone: scheduleTimezone, dateTimeSet, channels: storedChannels, firstComment: firstComment ? firstCommentText : "", disclosure, productTags, postTypes, postingMethods, tiktokPrivacyLevel, youtubePrivacyStatus, tiktokAllowComments, tiktokAllowDuet, tiktokAllowStitch, tiktokAutoAddMusic, tiktokDisableComments: !tiktokAllowComments || Boolean(tiktokCreatorInfo?.commentDisabled), tiktokDisableDuet: !tiktokAllowDuet || Boolean(tiktokCreatorInfo?.duetDisabled), tiktokDisableStitch: !tiktokAllowStitch || Boolean(tiktokCreatorInfo?.stitchDisabled), deliveryJobs: status === "scheduled" ? previous?.deliveryJobs || [] : [], publishResults, status: finalStatus, summary, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    setRecords(current => [record, ...current.filter(item => item.id !== record.id)]);
    return record;
  };
  const editPost = record => {
    baseline.current = null;
    setPanel(""); setPostMenu(false); setSidebarOpen(false); setToolPanel(""); setCustomize(false); setDatePickerOpen(false);
    if (!record) return openComposer();
    const retryChannels = [...new Set((record.publishResults || []).filter(result => result.status === "failed").map(result => channelIndexForResult(result, channels)).filter(index => index >= 0))];
    setEditingId(record.id); setPostText(record.text); setUploadedFiles(record.files || []); setAttachments(record.attachments || []); setSelectedChannels(retryChannels.length ? retryChannels : record.channels || [0, 1, 2]); setSelectedTemplate(null); setFirstComment(Boolean(record.firstComment)); setFirstCommentText(record.firstComment || ""); setDisclosure(Boolean(record.disclosure)); setProductTags(record.productTags || ""); setPostTypes(record.postTypes || { Instagram: "Post", TikTok: "Video", YouTube: "Video" }); setPostingMethods(record.postingMethods || {}); setTiktokPrivacyLevel(record.tiktokPrivacyLevel || ""); setTiktokAllowComments(record.tiktokAllowComments !== false); setTiktokAllowDuet(record.tiktokAllowDuet !== false); setTiktokAllowStitch(record.tiktokAllowStitch !== false); setTiktokAutoAddMusic(record.tiktokAutoAddMusic !== false); setYoutubePrivacyStatus(record.youtubePrivacyStatus || "private"); setPublishError("");
    const timezone = record.timezone || defaultTimezone();
    setScheduleTimezone(timezone);
    const restoredDate = record.scheduleAt && Number.isFinite(Date.parse(record.scheduleAt)) ? new Date(record.scheduleAt) : nextQuarter();
    const calendarDate = calendarDateInTimezone(restoredDate, timezone);
    setSelectedDate(calendarDate); setCalendarMonth(new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1));
    setSelectedTime(formatInTimezone(restoredDate, clockOptions(loadLocal("postly-preferences", {})["Time Format"] !== "24-hour"), timezone));
    setScheduleMode(record.scheduleMode || "Date & Time"); setDateTimeSet(Boolean(record.dateTimeSet)); setComposerOpen(true);
  };
  const changePosts = async (action, ids) => {
    if (action === "delete" || action === "draft") {
      const scheduled = records.filter(record => ids.includes(record.id) && record.status === "scheduled");
      for (const record of scheduled) {
        const outcomes = await cancelScheduledDelivery(record, { channelNames: channels.map(channel => channel.name) });
        const failures = outcomes.filter(item => item.status === "failed");
        if (failures.length) {
          const details = failures.map(item => `${item.channelName}: ${item.error}`).join(" · ");
          setRecords(current => current.map(item => item.id === record.id ? {
            ...item,
            deliveryJobs: (item.deliveryJobs || []).map(job => outcomes.find(outcome => outcome.provider && outcome.provider === job.provider) || job),
            summary: `Cancellation needs attention · ${details}`,
            updatedAt: new Date().toISOString(),
          } : item));
          notify(`Could not safely cancel scheduled delivery. The post remains in your queue. ${details}`);
          return;
        }
      }
    }
    const result = applyPostAction(records, ids, action);
    if (!result) return;
    setPostUndo(result.undo);
    setRecords(result.records);
    setToast("");
    setPostMenu(false);
  };
  const deletePost = id => changePosts("delete", [id]);
  const undoPosts = () => {
    if (!postUndo || postUndo.expiresAt <= Date.now()) { setPostUndo(null); return; }
    setRecords(current => undoPostAction(current, postUndo));
    setPostUndo(null);
    notify("Action undone. Any newer edits were kept.");
  };
  const refreshPublishStatus = async record => {
    const results = [];
    for (const item of record.publishResults || []) {
      if (item.provider !== "tiktok" || !item.publishId || item.status !== "publishing") { results.push(item); continue; }
      try {
        const response = await fetch(`/api/social/tiktok/publish-status?publishId=${encodeURIComponent(item.publishId)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not check TikTok's status.");
        results.push({ ...item, status: data.status, providerStatus: data.providerStatus, error: data.reason || "" });
      } catch (error) { setPublishError(error.message || "Could not check TikTok's status."); return; }
    }
    const pending = results.some(item => item.status === "publishing");
    const success = results.some(item => item.status === "published");
    const status = pending ? "publishing" : success ? "published" : "draft";
    const summary = pending ? "Sent to a channel; provider is still processing" : success ? `Published to ${results.filter(item => item.status === "published").map(item => item.provider).join(", ")}` : "TikTok could not publish this post; edit it and try again";
    setRecords(current => current.map(item => item.id === record.id ? { ...item, publishResults: results, status, summary, updatedAt: new Date().toISOString() } : item));
    notify(pending ? "TikTok is still processing this post" : success ? "TikTok finished publishing this post" : "TikTok could not publish this post");
  };
  const retryScheduledChannel = async (record, deliveryJob, confirmDuplicateRisk = false) => {
    const outcome = await retryScheduledDelivery(record, deliveryJob, { confirmDuplicateRisk });
    if (outcome.status === "failed") {
      notify(`${outcome.channelName}: ${outcome.error}`);
      return;
    }
    setRecords(current => current.map(item => item.id === record.id ? {
      ...item,
      deliveryJobs: (item.deliveryJobs || []).map(job => job.provider === outcome.provider ? { ...job, ...outcome } : job),
      summary: `Retry queued · ${outcome.channelName}`,
      updatedAt: new Date().toISOString(),
    } : item));
    notify(`${outcome.channelName} delivery retry queued on this Postly server.`);
  };
  const schedulePost = async () => {
    if ((!postText.trim() && !uploadedFiles.length) || postError || isUploading || isPublishing || isScheduling) return;
    if (scheduleMode === "Now" && publishValidationErrors.length) return;
    if (scheduleMode !== "Now") {
      setIsScheduling(true);
      setPublishError("");
      const record = storePost("scheduled");
      try {
        const outcomes = await registerScheduledDelivery(record, { readMedia, channelNames: channels.map(channel => channel.name) });
        const failures = outcomes.filter(item => item.status === "failed");
        const successful = outcomes.filter(item => item.status !== "failed");
        const summary = failures.length
          ? `Scheduled delivery needs attention · ${failures.map(item => `${item.channelName}: ${item.error}`).join(" · ")}`
          : `Scheduled delivery saved · ${successful.map(item => item.channelName).join(", ")}`;
        setRecords(current => current.map(item => item.id === record.id ? { ...item, deliveryJobs: outcomes, summary, updatedAt: new Date().toISOString() } : item));
        await refreshScheduledDeliveryStatuses();
        if (failures.length) notify(`Post saved in Queue, but delivery could not be registered for ${failures.map(item => item.channelName).join(", ")}. Check the channel status before its scheduled time.`);
        else notify("Scheduled delivery saved on this Postly server. The server dispatches due posts and resumes them after restart.");
        if (createAnother) openComposer({channels:selectedChannels});
        else closeComposer();
        baseline.current = null;
      } finally { setIsScheduling(false); }
      return;
    }

    setIsPublishing(true);
    setPublishError("");
    const posted = [];
    const failed = [];
    try {
      for (const index of selectedChannels) {
        const channel = channels[index];
        const provider = ({ Instagram: "instagram", TikTok: "tiktok", YouTube: "youtube" })[channel?.name];
        if (!provider) { failed.push({ index, name: channel?.name || "Channel", error: "Live publishing is not available for this channel yet." }); continue; }
        try {
          const form = new FormData();
          form.append("post", JSON.stringify({ text: postText, postType: postTypes[channel.name] || "", tiktokPrivacyLevel, youtubePrivacyStatus, disableComments: !tiktokAllowComments || Boolean(tiktokCreatorInfo?.commentDisabled), disableDuet: !tiktokAllowDuet || Boolean(tiktokCreatorInfo?.duetDisabled), disableStitch: !tiktokAllowStitch || Boolean(tiktokCreatorInfo?.stitchDisabled), autoAddMusic: tiktokAutoAddMusic, disclosure }));
          for (const attachment of attachments) {
            const blob = await readMedia(attachment.id);
            if (!blob) throw new Error(`Could not read ${attachment.name || "the selected media"} from this browser. Upload it again.`);
            form.append("media", blob, attachment.name || "media");
          }
          const response = await fetch(`/api/social/${provider}/publish`, { method: "POST", body: form });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error || `${channel.name} could not publish this post.`);
          if (!["published", "publishing"].includes(body.status)) throw new Error(body.error || `${channel.name} did not confirm publication.`);
          posted.push({ index, result: body });
        } catch (error) { failed.push({ index, name: channel?.name || "Channel", error: error.message || "Could not publish this post." }); }
      }
      const attemptedResults = [
        ...posted.map(({ index, result }) => ({ provider: result.provider || providerForChannel(channels[index]), channelId: channels[index]?.id || "", channelIndex: index, channelName: channels[index]?.name || "Channel", status: result.status, remoteId: result.remoteId || "", publishId: result.publishId || "", privacyStatus: result.privacyStatus || "", privacyLevel: result.privacyLevel || "", error: "" })),
        ...failed.map(item => ({ provider: providerForChannel(channels[item.index]), channelId: channels[item.index]?.id || "", channelIndex: item.index, channelName: item.name, status: "failed", error: item.error, remoteId: "", publishId: "", privacyStatus: "", privacyLevel: "" })),
      ];
      const record = attemptedResults.length ? storePost("published", { channels: selectedChannels, publishResults: attemptedResults }) : null;
      if (failed.length) {
        if (record) setEditingId(record.id);
        setSelectedChannels(failed.map(item => item.index));
        setActiveChannel(channels[failed[0].index]?.name || "Instagram");
        const publishedNames = posted.filter(item => item.result.status === "published").map(item => channels[item.index]?.name || "Channel");
        setPublishError(`${publishedNames.length ? `Published to ${publishedNames.join(", ")}. ` : ""}${failed.map(item => `${item.name}: ${item.error}`).join(" · ")} Only the channels that failed remain selected${publishedNames.length ? ", so retrying won't repost to the successful accounts." : " for retry."}`);
        return;
      }
      if (posted.length) {
        if (posted.some(item => item.result.status === "publishing")) notify("TikTok accepted the post and is still processing it. Check the Publishing tab for status.");
        else notify(`Published to ${posted.map(item => channels[item.index]?.name).join(", ")}`);
        if (createAnother) openComposer({ channels: selectedChannels });
        else closeComposer();
        baseline.current = null;
      } else setPublishError("No selected channel could publish this post.");
    } finally { setIsPublishing(false); }
  };
  const saveDraft = async () => {
    if (isUploading || isScheduling || (!postText.trim() && uploadedFiles.length === 0)) return;
    const previous = records.find(item => item.id === editingId);
    if (previous?.status === "scheduled") {
      const outcomes = await cancelScheduledDelivery(previous, { channelNames: channels.map(channel => channel.name) });
      const failures = outcomes.filter(item => item.status === "failed");
      if (failures.length) {
        setRecords(current => current.map(item => item.id === previous.id ? {
          ...item,
          deliveryJobs: (item.deliveryJobs || []).map(job => outcomes.find(outcome => outcome.provider && outcome.provider === job.provider) || job),
          summary: `Cancellation needs attention · ${failures.map(item => `${item.channelName}: ${item.error}`).join(" · ")}`,
          updatedAt: new Date().toISOString(),
        } : item));
        notify(`Could not safely cancel scheduled delivery. The post remains in your queue. ${failures.map(item => `${item.channelName}: ${item.error}`).join(" · ")}`);
        return;
      }
    }
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
    if (files.some(file => !supportedMediaTypes.has(file.type))) { notify(mediaTypeHint); return; }
    if (files.some(file => !file.size)) { notify("Empty media files can't be added. Choose another file."); return; }
    if (attachments.length + files.length > 35) { notify("A post can include at most 35 media files."); return; }
    const currentSize = attachments.reduce((total, item) => total + (item.size || 0), 0);
    if (currentSize + files.reduce((total, file) => total + file.size, 0) > 250 * 1024 * 1024) { notify("Uploads must stay under 250 MB per post."); return; }
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

  const duplicatePost = record => changePosts("duplicate", [record.id]);

  return (
    <div className="postly-app">
      <input id="media-upload" type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm" aria-label="Choose image or video files" multiple hidden disabled={isUploading} onChange={changeFiles} />
      <div inert={Boolean(panel || composerOpen)}>
        <Workspace
          path={["/", "/home"].includes(window.location.pathname) ? "/home" : window.location.pathname}
          organizationName={organizationName} onOrganizationChange={setOrganizationName}
          connected={connected} socialStatus={socialStatus} channelProfiles={profiles}
          channelDefinitions={channels.map((channel,index)=>({...channel,id:["6abbdc0fea19ca0bde244c7e","6abbdb9eea19ca0bde244939","6abbdadbea19ca0bde24433e"][index] || channel.name.toLowerCase(),icon:<SocialMark icon={channel.icon} brand={channel.brand} color={channel.color} size={17}/>}))}
          records={records} onDelete={deletePost} onEdit={editPost} onDuplicate={duplicatePost} onBulkAction={changePosts} onRefreshPublish={refreshPublishStatus} onRefreshScheduledDelivery={refreshScheduledDeliveryStatuses} onRetryScheduledDelivery={retryScheduledChannel}
          savedTemplates={personalTemplates} setSavedTemplates={setPersonalTemplates}
          scheduledCount={scheduledPosts} onRefresh={refreshSocialStatus} onCompose={openComposer}
          onConnect={network => { setConnectNetwork(typeof network === "string" ? network : "Instagram"); setPanel("Connect Channel"); }}
        />
      </div>

      {composerOpen && <>
        <button className="scrim composer-scrim" aria-label="Close composer overlay" onClick={requestCloseComposer} />
        <section inert={Boolean(panel)} className="composer-modal" role="dialog" aria-modal="true" aria-label="Create Post">
          <header className="composer-header" inert={discardOpen}><div><h2>{editingId ? "Edit Post" : "Create Post"}</h2><p>Future posts stay in Postly's local queue and won't publish automatically.</p></div><div className="composer-tools">
              <button className={`composer-tool ${toolPanel === "templates" ? "tool-active" : ""}`} title="Templates" aria-label="Templates" onClick={() => { setToolPanel(toolPanel === "templates" ? "" : "templates"); setCustomize(false); }}><FileText size={17} /></button>
              <button className={`composer-tool ${toolPanel === "ai" ? "tool-active" : ""}`} title="Writing Assistant" aria-label="Writing Assistant" onClick={() => { if (toolPanel === "ai") setToolPanel(""); else { setToolPanel("ai"); setAiStep(aiOnboarded ? 4 : 0); setAiReady(aiOnboarded); setCustomize(false); } }}><WandSparkles size={17} /></button>
              <button className={`composer-tool ${toolPanel === "preview" ? "tool-active" : ""}`} title="Preview" aria-label="Preview" onClick={() => { setToolPanel(toolPanel === "preview" ? "" : "preview"); setCustomize(false); }}><ImageIcon size={17} /></button>
              <button className="icon-button" title="Close Composer" aria-label="Close Composer" onClick={requestCloseComposer}><X size={19} /></button>
            </div>
          </header>

          <div inert={discardOpen} className={`composer-main ${toolPanel ? "with-panel" : ""}`}>
              <div className="editor-column">
                <div className="channel-picker">
                  <div className="channel-picker-heading"><span id="channel-picker-label" className="field-label">Post to</span><span className="channel-selection-count">{selectedChannels.length} of {channels.length} selected</span></div>
                  <div className="channel-picker-list" role="group" aria-labelledby="channel-picker-label">{channels.map((channel, index) => <ChannelAvatar key={channel.name} channel={channel} active={selectedChannels.includes(index)} onClick={() => toggleChannel(index)} />)}<button type="button" className="add-channel-button" aria-label="Add channel" onClick={() => setPanel("Connect Channel")}><Plus size={17} /></button></div>
                  {!selectedChannels.length && <span className="channel-picker-hint" role="status">Select at least one channel to publish.</span>}
                </div>
                {customize ? <div className="customize-panel" data-popover>
                  <div className="customize-title"><div><h3>Customize for each channel</h3><p>Adjust settings for your selected channels.</p></div><button className="icon-button" aria-label="Close channel customization" onClick={() => setCustomize(false)}><X size={17} /></button></div>
                  <div className="customize-tabs">{channels.filter((channel, index) => selectedChannels.includes(index)).map((channel) => <button key={channel.name} className={activeChannel === channel.name ? "current" : ""} onClick={() => setActiveChannel(channel.name)}><SocialMark icon={channel.icon} brand={channel.brand} color={channel.color} size={14} />{channel.name}</button>)}</div>
                  {scheduleMode === "Now" && publishValidationErrors.length > 0 && <div className="channel-validation" role="alert"><b>Review before publishing</b><ul>{publishValidationErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></div>}
                  {scheduleMode !== "Now" && <p className="local-queue-hint" role="status">Scheduled delivery is saved on this Postly server. Due posts dispatch while the server runs and resume after a restart. Hosted background delivery is not set up.</p>}
                  <div className="customize-content">
                    <label className="setting-label">Post type</label><div className="radio-row">{(activeChannel === "Instagram" ? ["Post", "Reel", "Story"] : activeChannel === "TikTok" ? ["Video", "Photo"] : activeChannel === "YouTube" ? ["Video", "Short"] : ["Post"]).map(type => <label key={type} className="radio-option"><input type="radio" name="post-type" disabled={activeChannel === "Instagram" && type === "Story"} checked={(postTypes[activeChannel] || (activeChannel === "TikTok" ? "Video" : "Post")) === type} onChange={() => setPostTypes(current => ({ ...current, [activeChannel]: type }))} />{type}</label>)}</div>
                    {activeChannel === "Instagram" && <small className="setting-hint">Instagram publishing supports feed posts, Reels, and carousels. Story publishing is not available for this connection.</small>}
                    <div className="media-placeholder"><Upload size={18} /><span>Add media for {activeChannel}</span><button type="button" disabled={isUploading} onClick={() => document.getElementById("media-upload")?.click()}>{isUploading ? "Saving media…" : "Choose files"}</button></div>
                    <small className="setting-hint">{activeChannel === "TikTok" && postTypes.TikTok === "Photo" ? "TikTok Photo accepts JPEG or WebP images, up to 20 MB each." : activeChannel === "YouTube" || (activeChannel === "TikTok" && postTypes.TikTok === "Video") ? "Upload one MP4, MOV, or WebM video." : activeChannel === "Instagram" ? "Instagram supports up to 10 photos/videos. Use Post for photos or carousels and Reel for a single video." : "Media is saved on this device for your local queue."}</small>
                    {activeChannel === "Instagram" && <><button className="setting-row" onClick={() => setUtilityMenu(utilityMenu === "music" ? "" : "music")}><span>Music</span><Plus size={15} /></button><button className="setting-row" onClick={() => setUtilityMenu(utilityMenu === "products" ? "" : "products")}><span>Tag Products</span><Plus size={15} /></button><small className="setting-hint">Music and product tags are saved as notes and aren't sent through this publishing connection.</small></>}
                    {activeChannel === "TikTok" && <div className="setting-block provider-publish-settings">
                      <label className="setting-label" htmlFor="tiktok-audience">Audience</label>
                      {!socialStatus.tiktok?.connected ? <small>Connect a TikTok account to load its audience options.</small> : tiktokInfoLoading ? <small role="status">Loading TikTok account options…</small> : tiktokInfoError ? <small className="composer-error" role="alert">{tiktokInfoError}</small> : tiktokCreatorInfo ? <>
                        <small>Posting to {tiktokCreatorInfo.nickname || tiktokCreatorInfo.username || "your TikTok account"}.</small>
                        <select id="tiktok-audience" required value={tiktokPrivacyLevel} onChange={event => setTiktokPrivacyLevel(event.target.value)}><option value="">Choose an audience</option>{(tiktokCreatorInfo.privacyLevelOptions || []).map(option => <option key={option} value={option}>{({ PUBLIC_TO_EVERYONE: "Everyone", MUTUAL_FOLLOW_FRIENDS: "Friends", FOLLOWER_OF_CREATOR: "Followers", SELF_ONLY: "Only me" })[option] || option}</option>)}</select>
                        <label className="setting-toggle-row"><span>Allow comments</span><input type="checkbox" checked={tiktokCreatorInfo.commentDisabled ? false : tiktokAllowComments} disabled={tiktokCreatorInfo.commentDisabled} onChange={event => setTiktokAllowComments(event.target.checked)} /></label>
                        {postTypes.TikTok === "Video" && <><label className="setting-toggle-row"><span>Allow Duet</span><input type="checkbox" checked={tiktokCreatorInfo.duetDisabled ? false : tiktokAllowDuet} disabled={tiktokCreatorInfo.duetDisabled} onChange={event => setTiktokAllowDuet(event.target.checked)} /></label><label className="setting-toggle-row"><span>Allow Stitch</span><input type="checkbox" checked={tiktokCreatorInfo.stitchDisabled ? false : tiktokAllowStitch} disabled={tiktokCreatorInfo.stitchDisabled} onChange={event => setTiktokAllowStitch(event.target.checked)} /></label><small>Maximum video length for this account: {tiktokCreatorInfo.maxVideoPostDurationSec || "unknown"} seconds.</small></>}
                        {postTypes.TikTok === "Photo" && <label className="setting-toggle-row"><span>Automatically add music</span><input type="checkbox" checked={tiktokAutoAddMusic} onChange={event => setTiktokAutoAddMusic(event.target.checked)} /></label>}
                      </> : <small>Connect TikTok to load available audience settings.</small>}
                    </div>}
                    {activeChannel === "YouTube" && <div className="setting-block provider-publish-settings"><label className="setting-label" htmlFor="youtube-visibility">Video visibility</label><select id="youtube-visibility" value={youtubePrivacyStatus} onChange={event => setYoutubePrivacyStatus(event.target.value)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select><small>New YouTube uploads default to Private. Change this before publishing if you want another visibility.</small><small>The Short label is a planning cue; YouTube classifies Shorts from the uploaded video.</small></div>}
                    {utilityMenu === "music" && <div className="setting-expansion">Add a video with its audio track using Upload media.</div>}{utilityMenu === "products" && <label className="setting-expansion">Product names or links<input aria-label="Product tags" value={productTags} onChange={event => setProductTags(event.target.value)} placeholder="Add product names or links" /></label>}<div className="setting-block"><label className="setting-label">Posting method</label><select value={postingMethods[activeChannel] || "Automatic"} onChange={event => setPostingMethods(current => ({ ...current, [activeChannel]: event.target.value }))}><option>Automatic</option><option>Notify Me</option></select><small>{postingMethods[activeChannel] === "Notify Me" ? "Notifications are not connected yet." : "Publish Now sends immediately. Future scheduled posts stay in Postly's local queue."}</small></div>
                    <button className="setting-row" onClick={() => setFirstComment((value) => !value)}><span>First Comment</span><span className={`switch ${firstComment ? "on" : ""}`} /></button>
                    {firstComment && <><textarea className="first-comment-input" aria-label="First comment" value={firstCommentText} onChange={event => setFirstCommentText(event.target.value)} placeholder="Write your first comment…" /><small className="setting-hint">First comments are saved in Postly but aren't published by these connections yet.</small></>}<button className="setting-row" onClick={() => setPanel("Invite a Team Member")}><span>Collaborators</span><Plus size={15} /></button>
                    <button className="setting-row" onClick={() => setDisclosure(value => !value)}><span>AI-Generated disclosure</span><span className={`switch ${disclosure ? "on" : ""}`} /></button><small className="setting-hint">The AI-generated label is sent to TikTok. Other providers do not receive it yet.</small>
                  </div>
                </div> : <>
                  <div className="editor-card">
                    {selectedTemplate && <div className="attached-template"><Tags size={13} />{selectedTemplate}<button aria-label="Remove template" onClick={() => setSelectedTemplate(null)}><X size={13} /></button></div>}
                    <label className="copy-field-label" htmlFor="composer-copy">Post copy</label><textarea id="composer-copy" aria-label="composer textbox" aria-invalid={postText.length > 2200} placeholder="Write your post copy…" value={postText} onChange={(event) => setPostText(event.target.value)} />
                    <button type="button" className={`upload-area ${mediaDragging ? "is-dragging" : ""}`} disabled={isUploading} onClick={() => document.getElementById("media-upload")?.click()} onDragEnter={event => { event.preventDefault(); setMediaDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMediaDragging(false); }} onDrop={event => { event.preventDefault(); setMediaDragging(false); changeFiles(event); }}><Upload size={17} /><span>{isUploading ? "Saving media…" : <>Drag &amp; drop or <b>choose files</b></>}</span></button><small className="setting-hint">{mediaTypeHint} Up to 35 files and 250 MB per post; individual network limits apply. Media is saved on this device.</small>
                    {uploadedFiles.length > 0 && <div className="media-attachments" role="list" aria-label="Attached media">{uploadedFiles.map((file, index) => { const attachment = attachments[index]; const preview = attachment && mediaPreviews[attachment.id]; return <article className="media-attachment" role="listitem" key={`${attachment?.id || file}-${index}`}><div className="media-attachment-preview">{preview && attachment?.type.startsWith("video/") ? <video muted playsInline preload="metadata" src={preview} aria-label={`Video preview: ${file}`} /> : preview ? <img src={preview} alt={`Preview: ${file}`} /> : <ImageIcon size={20} aria-hidden="true" />}</div><span title={file}>{file}</span><button type="button" aria-label={`Remove ${file}`} disabled={isUploading} onClick={() => removeFile(index)}><X size={13} /></button></article>; })}</div>}
                    <div className="editor-utility-row" data-popover><button aria-label="More integration options" onClick={() => setUtilityMenu(utilityMenu === "integrations" ? "" : "integrations")}><MoreHorizontal size={18} /></button><button aria-label="Select emoji" onClick={() => setUtilityMenu(utilityMenu === "emoji" ? "" : "emoji")}><Smile size={17} /></button><button aria-label="Hashtag Manager" onClick={() => setPanel("Hashtag Manager")}><Hash size={17} /></button>{utilityMenu && <div className="integration-menu popup-menu" role="menu">{utilityMenu === "emoji" ? <div className="emoji-options">{["✨", "🙌", "💡", "❤️", "🎉", "👋", "🌱", "📣"].map(emoji => <button key={emoji} aria-label={`Insert ${emoji}`} onClick={() => { setPostText(value => value + emoji); setUtilityMenu(""); }}>{emoji}</button>)}</div> : utilityMenu === "music" ? <span className="menu-note">Upload a video with your chosen audio track.</span> : <><button role="menuitem" onClick={() => { document.getElementById("media-upload").click(); setUtilityMenu(""); }}>Upload media</button><button role="menuitem" onClick={() => { setPanel("Add a link"); setUtilityMenu(""); }}>Add a link</button><button role="menuitem" onClick={() => { setPanel("Hashtag Manager"); setUtilityMenu(""); }}>Hashtag Manager</button></>}</div>}<span className="character-count" aria-label="Character count">{postText.length} / 2,200 characters</span></div>
                  </div>
                </>}
              </div>

              {toolPanel === "templates" ? <aside className="template-drawer">
                <div className="drawer-heading"><div><h3>Templates</h3><p>Find a starting point for your next post.</p></div><button className="icon-button" aria-label="Close templates" onClick={() => setToolPanel("")}><X size={17} /></button></div>
                <div className="template-tabs"><button className={templateTab === "Discover" ? "current" : ""} onClick={() => setTemplateTab("Discover")}>Discover</button><button className={templateTab === "Personal" ? "current" : ""} onClick={() => setTemplateTab("Personal")}>Personal</button></div>
                <label className="template-search" data-popover><Search size={15} /><input placeholder="Search templates" value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} /><button type="button" aria-label="Filter templates" onClick={() => setFilterOpen((value) => !value)}><Filter size={15} /></button></label>
                {filterOpen && <div className="filter-popover" data-popover><strong>Filter templates</strong><label><input type="checkbox" checked={socialOnly} onChange={event => setSocialOnly(event.target.checked)} /> Social posts</label><label><input type="checkbox" checked={savedOnly} onChange={event => setSavedOnly(event.target.checked)} /> Saved templates</label></div>}
                <button className="new-template-button" onClick={() => { setTemplateEditor(true); setTemplateName(""); setTemplateBody(""); }}><Plus size={15} />New Template</button>
                {templateEditor && <form className="template-editor" onSubmit={event => { event.preventDefault(); if (!templateName.trim() || !templateBody.trim()) return; setPersonalTemplates(current => [{ id: crypto.randomUUID(), title: templateName.trim(), description: templateBody.trim(), icon: "question" }, ...current.filter(item => item.title !== templateName.trim())]); setTemplateTab("Personal"); setTemplateQuery(""); setSavedOnly(false); setTemplateEditor(false); }}><label>Template name<input required value={templateName} onChange={event => setTemplateName(event.target.value)} /></label><label>Post content<textarea required rows={4} value={templateBody} onChange={event => setTemplateBody(event.target.value)} /></label><div><button type="button" onClick={() => setTemplateEditor(false)}>Cancel</button><button type="submit">Save Template</button></div></form>}<div className="drawer-template-list">{filteredTemplates.map((item) => <button key={item.title} className={`drawer-template ${selectedTemplate === item.title ? "chosen" : ""}`} onClick={() => useTemplate(item)}><span className="template-icon"><TemplateIcon name={item.icon} /></span><span><b>{item.title}</b><small>{item.description}</small></span></button>)}{filteredTemplates.length === 0 && <p className="no-results">No templates match your search.</p>}</div>
              </aside> : toolPanel === "preview" ? <aside className="preview-panel"><div className="panel-title"><div><h3>Post Previews</h3></div></div>{postText.trim() || uploadedFiles.length ? selectedChannels.length ? selectedChannels.map(index => <article className="social-preview" key={index}><div className="preview-account"><span className="preview-avatar"><UserRound size={18}/></span><span><b>{channels[index].handle}</b><small>{channels[index].name} · Just now</small></span><SocialMark icon={channels[index].icon} brand={channels[index].brand} color={channels[index].color} size={15}/></div><p>{postText}</p>{uploadedFiles.map((file, index) => <div className="preview-media" key={index}>{mediaPreviews[attachments[index]?.id] ? attachments[index]?.type.startsWith("video/") ? <video controls src={mediaPreviews[attachments[index].id]} aria-label={file} /> : <img src={mediaPreviews[attachments[index].id]} alt={file} /> : <ImageIcon size={25}/>}<span>{file}</span></div>)}</article>) : <p className="no-results">Select a channel to preview your post.</p> : <div className="preview-empty"><ImageIcon size={25} /><p>See your post's preview here</p></div>}</aside> : toolPanel === "ai" ? <aside className="ai-panel"><div className="ai-panel-title"><WandSparkles size={15}/><h3>Writing Assistant</h3></div><div className="ai-ready"><p className="panel-note">AI generation is not connected. Use a template for inspiration, or collect your own writing brief here.</p><button className="new-template-button" onClick={()=>setToolPanel("templates")}><FileText size={15}/> Browse templates</button><label htmlFor="ai-prompt">What do you want to share?</label><textarea id="ai-prompt" placeholder="Your topic, audience, key points, and the next step you want readers to take." value={aiPrompt} onChange={event=>setAiPrompt(event.target.value)}/><button className="ai-generate" disabled={!aiPrompt.trim()} onClick={()=>{setPostText(current=>[current,aiPrompt.trim()].filter(Boolean).join("\n\n"));setToolPanel("");notify("Writing brief added to your post")}}>Add writing brief</button></div></aside> : null}
          </div>

          <footer className="composer-footer" inert={discardOpen}>
            <div className="footer-top-row">{isUploading && <span role="status" className="composer-status">Saving media…</span>}{isPublishing && <span role="status" className="composer-status">Publishing to selected channels…</span>}{isScheduling && <span role="status" className="composer-status">Saving scheduled delivery…</span>}{customize && postError && <span role="alert" className="composer-error">{postError}</span>}{publishError && <span role="alert" className="composer-error">{publishError}</span>}<label className="create-another"><input type="checkbox" checked={createAnother} onChange={(event) => setCreateAnother(event.target.checked)} />Create Another</label><button type="button" className="secondary-button" disabled={isUploading || isPublishing || isScheduling || (!postText.trim() && uploadedFiles.length === 0)} onClick={saveDraft}>Save Draft</button><button type="button" className="secondary-button composer-cancel" disabled={isUploading || isPublishing || isScheduling} onClick={requestCloseComposer}>Cancel</button></div>
            <div className="footer-actions">
              <div className="schedule-wrap"><button type="button" className="schedule-select" aria-label="Choose date and time" aria-expanded={datePickerOpen} onClick={() => { setDateTimeSet(true); setDatePickerOpen(value => !value); }}><CalendarDays size={16} />{scheduleLabel}<ChevronDown size={15} /></button></div>
              <button className="primary-button" disabled={isUploading || isPublishing || isScheduling || (customize && ((!postText.trim() && uploadedFiles.length === 0) || Boolean(postError) || (scheduleMode === "Now" && publishValidationErrors.length > 0)))} onClick={() => { if (customize) schedulePost(); else { setCustomize(true); setActiveChannel(channels[selectedChannels[0] ?? 0].name); setToolPanel(""); setUtilityMenu(""); setPublishError(""); } }}>{isPublishing ? "Publishing…" : isScheduling ? "Saving schedule…" : customize ? scheduleMode === "Now" ? "Publish now" : "Schedule post" : <>Customize <ArrowRight size={15} /></>}</button>
            </div>
          </footer>
          {datePickerOpen && <div inert={discardOpen} className="date-time-picker" role="dialog" aria-label="Schedule date and time">
            <div className="calendar-header"><h3>{calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3><div><button className="icon-button" aria-label="Previous month" disabled={calendarMonth.getFullYear() < scheduleToday.getFullYear() || (calendarMonth.getFullYear() === scheduleToday.getFullYear() && calendarMonth.getMonth() <= scheduleToday.getMonth())} onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="Next month" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button></div></div>
            <div className="calendar-weekdays">{(startOfWeek === "Monday" ? "MTWTFSS" : "SMTWTFS").split("").map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
            <div className="calendar-days">{calendarDays.map((day) => {
              const today = calendarDateInTimezone(new Date(), scheduleTimezone); today.setHours(0, 0, 0, 0);
              const isCurrentMonth = day.getMonth() === calendarMonth.getMonth();
              const isSelected = day.toDateString() === selectedDate.toDateString();
              return <button key={day.toISOString()} type="button" disabled={day < today} className={`${isCurrentMonth ? "" : "outside-month"} ${isSelected ? "selected" : ""}`} onClick={() => setSelectedDate(new Date(day.getFullYear(), day.getMonth(), day.getDate()))}>{day.getDate()}</button>;
            })}</div>
            <div className="date-time-footer">
              <label htmlFor="schedule-time">Select Time</label>
              <div className="time-input-wrap"><Clock3 size={15} /><input id="schedule-time" aria-label="Select Time" value={selectedTime} onChange={(event) => setSelectedTime(event.target.value)} /></div>
              {dateError && <span className="composer-error" role="alert">{dateError}</span>}<span className="timezone-label">Time zone: {scheduleTimezone === "Johannesburg" ? "Johannesburg" : resolveTimezone(scheduleTimezone)}</span>
              <div className="date-picker-actions"><Popover label="More posting actions" className="schedule-actions-disclosure" panelClassName="date-time-actions-popover" buttonClassName="more-posting-actions" align="left" trigger={<><ChevronLeft size={14} />More Posting Actions</>}>{close => scheduleOptions.map(option => <button key={option.label} type="button" onClick={() => { chooseSchedule(option.label); close(); if (option.label !== "Set Date and Time") window.requestAnimationFrame(() => document.querySelector(".schedule-select")?.focus()); }} className={scheduleMode === (option.label === "Set Date and Time" ? "Date & Time" : option.label) ? "selected" : ""}><span>{option.label}</span><small>{option.detail}</small></button>)}</Popover><button type="button" className="date-picker-done" disabled={Boolean(dateError)} onClick={() => { if (dateError) return; setDatePickerOpen(false); setDateTimeSet(true); setScheduleMode("Date & Time"); }}>Done</button></div>
            </div>
          </div>}
          {discardOpen && <div className="discard-layer"><button className="scrim" aria-label="Keep editing" onClick={() => setDiscardOpen(false)} /><section className="discard-dialog" role="alertdialog" aria-modal="true" aria-label="Unsaved post"><h3>Save your changes?</h3><p>Your post has unsaved changes.</p><div><button onClick={() => setDiscardOpen(false)}>Keep Editing</button><button onClick={closeComposer}>Discard Changes</button><button onClick={saveDraft}>Save Draft</button></div></section></div>}
        </section>
      </>}

      {panel && <InteractionPanel key={panel} title={panel} initialNetwork={connectNetwork} onClose={() => { setPanel(""); const clean = new URL(window.location.href); clean.searchParams.delete("panel"); clean.searchParams.delete("network"); history.replaceState({}, "", clean.pathname + clean.search); }} posts={records} connected={connected} onSave={(title, value) => { if (title === "Organization settings") setOrganizationName(value); }} onConnect={(network, handle) => { setProfiles(current => ({ ...current, [network]: handle })); setConnected(current => current.includes(network) ? current : [...current, network]); notify(`${network} profile saved locally`); }} onEdit={editPost} onDelete={deletePost} onRefreshPublish={refreshPublishStatus} onNotify={(value, insert) => insert ? setPostText(current => `${current}${current ? "\n" : ""}${value}`) : setPanel(value)} />}
      <div className="postly-notices">
        {toast && <div role="status" className="toast"><CheckCircle2 size={17} />{toast}</div>}
        {postUndo && <div className="postly-undo-notice"><span role="status">{postUndo.message}</span><button onClick={undoPosts}>Undo</button><button aria-label="Dismiss undo" onClick={() => setPostUndo(null)}><X size={16}/></button></div>}
      </div>
    </div>
  );
}
