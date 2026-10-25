const providerByChannel = { Instagram: "instagram", TikTok: "tiktok", YouTube: "youtube" };

function providerPost(record, channelName) {
  return {
    text: record.text || "",
    postType: record.postTypes?.[channelName] || "",
    tiktokPrivacyLevel: record.tiktokPrivacyLevel || "",
    youtubePrivacyStatus: record.youtubePrivacyStatus || "private",
    disclosure: Boolean(record.disclosure),
    disableComments: record.tiktokDisableComments ?? record.tiktokAllowComments === false,
    disableDuet: record.tiktokDisableDuet ?? record.tiktokAllowDuet === false,
    disableStitch: record.tiktokDisableStitch ?? record.tiktokAllowStitch === false,
    autoAddMusic: Boolean(record.tiktokAutoAddMusic),
  };
}

export async function registerScheduledDelivery(record, { fetchImpl = fetch, readMedia, channelNames = [] } = {}) {
  const outcomes = [];
  const channels = [...new Set(Array.isArray(record.channels) ? record.channels : [])];
  for (const index of channels) {
    const channelName = channelNames[index] || "";
    const provider = providerByChannel[channelName];
    if (!provider) {
      outcomes.push({ provider: "", channelIndex: index, channelName: channelName || "Channel", status: "failed", error: `Scheduled delivery is not available for ${channelName || "this channel"}.` });
      continue;
    }
    try {
      const form = new FormData();
      form.append("post", JSON.stringify(providerPost(record, channelName)));
      form.append("schedule", JSON.stringify({ postId: record.id, scheduledAt: record.scheduleAt }));
      for (const attachment of record.attachments || []) {
        const blob = await readMedia?.(attachment.id);
        if (!blob) throw new Error(`Could not read ${attachment.name || "scheduled media"} from this browser. Upload it again.`);
        form.append("media", blob, attachment.name || "media");
      }
      const response = await fetchImpl(`/api/scheduled-posts/${provider}`, { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Postly could not save this delivery job.");
      outcomes.push({ provider, channelIndex: index, channelName, status: body.job?.status || "queued", jobId: body.job?.id || "", error: body.job?.error || "", attempts: body.job?.attempts || 0, nextAttemptAt: body.job?.nextAttemptAt || null, mayHavePublished: Boolean(body.job?.mayHavePublished) });
    } catch (error) {
      outcomes.push({ provider, channelIndex: index, channelName, status: "failed", jobId: "", error: error.message || "Postly could not save this delivery job.", mayHavePublished: false });
    }
  }
  return outcomes;
}

export async function cancelScheduledDelivery(record, { fetchImpl = fetch, channelNames = [] } = {}) {
  const outcomes = [];
  const channels = [...new Set(Array.isArray(record.channels) ? record.channels : [])];
  for (const index of channels) {
    const channelName = channelNames[index] || "";
    const provider = providerByChannel[channelName];
    if (!provider) continue;
    try {
      const response = await fetchImpl(`/api/scheduled-posts/${provider}/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Postly could not cancel the ${channelName} delivery.`);
      outcomes.push({ provider, channelIndex: index, channelName, status: body.job?.status || (body.removed ? "cancelled" : "not_found"), error: "" });
    } catch (error) {
      outcomes.push({ provider, channelIndex: index, channelName, status: "failed", error: error.message || `Postly could not cancel the ${channelName} delivery.` });
    }
  }
  return outcomes;
}

export async function fetchScheduledDeliveryStatuses({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/api/scheduled-posts");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Postly could not refresh scheduled delivery status.");
  return Array.isArray(body.jobs) ? body.jobs : [];
}

export async function retryScheduledDelivery(record, deliveryJob, { fetchImpl = fetch, confirmDuplicateRisk = false } = {}) {
  const provider = deliveryJob?.provider;
  if (!["instagram", "tiktok", "youtube"].includes(provider)) {
    return { provider: provider || "", channelIndex: deliveryJob?.channelIndex, channelName: deliveryJob?.channelName || "Channel", status: "failed", error: "This channel does not support scheduled retries." };
  }
  try {
    const response = await fetchImpl(`/api/scheduled-posts/${provider}/${encodeURIComponent(record.id)}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmDuplicateRisk }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Postly could not retry this delivery.");
    return {
      provider,
      channelIndex: deliveryJob.channelIndex,
      channelName: deliveryJob.channelName || ({ instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" })[provider],
      status: body.job?.status || "queued",
      jobId: body.job?.id || deliveryJob.jobId || "",
      attempts: body.job?.attempts || 0,
      nextAttemptAt: body.job?.nextAttemptAt || null,
      mayHavePublished: Boolean(body.job?.mayHavePublished),
      error: body.job?.error || "",
    };
  } catch (error) {
    return { provider, channelIndex: deliveryJob.channelIndex, channelName: deliveryJob.channelName || "Channel", status: "failed", error: error.message || "Postly could not retry this delivery.", mayHavePublished: Boolean(deliveryJob.mayHavePublished) };
  }
}
