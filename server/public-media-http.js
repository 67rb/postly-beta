const publicMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function unsatisfiableRange(headers, size) {
  return new Response(null, {
    status: 416,
    headers: { ...headers, "content-range": `bytes */${size}` },
  });
}

export async function createPublicMediaResponse(request, url, readAsset) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }

  const match = url.pathname.match(/^\/api\/social\/media\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i);
  if (!match) return notFound();

  let asset;
  try { asset = await readAsset(match[1]); }
  catch { return new Response("Media storage is temporarily unavailable", { status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
  const size = asset?.data?.length;
  const type = asset?.metadata?.type;
  if (!asset || !Buffer.isBuffer(asset.data) || !publicMediaTypes.has(type) || !Number.isSafeInteger(size) || size < 1 || asset.metadata.size !== size) return notFound();

  const headers = {
    "content-type": type,
    "content-length": String(size),
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=3600, immutable",
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
  };
  const range = request.headers.get("range");
  if (range) {
    const parsed = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!parsed || (!parsed[1] && !parsed[2])) return unsatisfiableRange(headers, size);

    let start;
    let end;
    if (!parsed[1]) {
      const suffixLength = Number(parsed[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return unsatisfiableRange(headers, size);
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(parsed[1]);
      end = parsed[2] ? Number(parsed[2]) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || start >= size) return unsatisfiableRange(headers, size);
      end = Math.min(end, size - 1);
    }

    const data = asset.data.subarray(start, end + 1);
    return new Response(request.method === "HEAD" ? null : data, {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(data.length),
        "content-range": `bytes ${start}-${end}/${size}`,
      },
    });
  }

  return new Response(request.method === "HEAD" ? null : asset.data, { headers });
}
