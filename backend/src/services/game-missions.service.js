const cheerio = require("cheerio");
const { createHash } = require("node:crypto");
const { isIP } = require("node:net");

const REQUEST_TIMEOUT_MS = 12000;
const MISSION_MEDIA_BUCKET = "game-mission-media";
const MAX_LOCAL_MEDIA_BYTES = 20 * 1024 * 1024;
const LOCAL_MEDIA_LICENSE = /^(?:CC0\b|CC BY(?:-SA)?(?:\s|$)|Public domain\b)/i;
const inFlightImports = new Map();
const inFlightMissionDetails = new Map();

const cleanText = value => String(value || "")
    .replace(/\[\s*edit\s*\]/gi, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const cleanHtmlText = value => cheerio.load(`<div>${String(value || "")}</div>`)("div")
    .text()
    .replace(/\s+/g, " ")
    .trim();

const sanitizeMissionArticle = ($, content, sourceUrl) => {
    const allowedTags = new Set([
        "a", "b", "blockquote", "br", "caption", "code", "dd", "div", "dl",
        "dt", "em", "h2", "h3", "h4", "h5", "hr", "i", "img", "li", "ol",
        "p", "pre", "small", "span", "strong", "sub", "sup", "table", "tbody",
        "td", "th", "thead", "tr", "u", "ul"
    ]);
    const blockedTags = new Set([
        "iframe", "object", "script", "style", "svg", "video"
    ]);

    content.find([
        "iframe",
        "video",
        "figure.gallery",
        ".gallery",
        ".thumb:not(:has([data-mission-media-index]))",
        ".mw-editsection",
        ".toc",
        ".portable-infobox",
        ".references",
        ".mw-references-wrap",
        "noscript"
    ].join(",")).remove();

    content.find("*").toArray().reverse().forEach(element => {
        const node = $(element);
        const tag = element.tagName?.toLowerCase();
        if (!tag) return;
        if (blockedTags.has(tag)) {
            node.remove();
            return;
        }
        if (tag === "img") {
            const mediaIndex = node.attr("data-mission-media-index");
            const alt = node.attr("alt") || "";
            Object.keys(element.attribs || {}).forEach(attribute => {
                node.removeAttr(attribute);
            });
            if (!/^\d+$/.test(mediaIndex || "")) {
                node.remove();
                return;
            }
            node.attr("data-mission-media-index", mediaIndex);
            node.attr("alt", alt);
            return;
        }
        if (tag === "span") {
            const mediaIndex = node.attr("data-mission-media-index");
            Object.keys(element.attribs || {}).forEach(attribute => {
                node.removeAttr(attribute);
            });
            if (/^\d+$/.test(mediaIndex || "")) {
                node.attr("data-mission-media-index", mediaIndex);
            }
            return;
        }
        if (!allowedTags.has(tag)) {
            node.replaceWith(node.contents());
            return;
        }

        const href = tag === "a" ? node.attr("href") : null;
        Object.keys(element.attribs || {}).forEach(attribute => {
            node.removeAttr(attribute);
        });
        if (href) {
            try {
                const url = new URL(href, sourceUrl);
                if (url.protocol === "https:" || url.protocol === "http:") {
                    node.attr("href", url.href);
                    node.attr("target", "_blank");
                    node.attr("rel", "noopener noreferrer");
                }
            } catch {
                node.removeAttr("href");
            }
        }
    });

    return content.html() || "";
};

const normalizeTitle = value => cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const categoryFromHeading = heading => {
    const value = normalizeTitle(heading);
    if (value.includes("main quest") || value.includes("main job")) return "main";
    if (value.includes("secondary quest") || value.includes("side quest") ||
        value.includes("side job")) {
        return "side";
    }
    if (value.includes("gig")) return "gig";
    if (value.includes("minor job")) return "minor";
    if (value.includes("contract")) return "contract";
    if (value.includes("treasure hunt")) return "treasure_hunt";
    return null;
};

const MISSION_CATEGORIES = new Set([
    "main", "side", "contract", "gig", "minor", "treasure_hunt", "expansion", "other"
]);

const normalizeConfiguredSource = row => {
    const config = row.content && typeof row.content === "object"
        ? { ...row, ...row.content }
        : row;
    let baseUrl;
    let apiUrl;
    try {
        baseUrl = new URL(config.wiki_base_url);
        apiUrl = new URL(config.api_url || "/api.php", baseUrl);
    } catch {
        throw new Error(`Invalid wiki URL configured for ${row.source_name}.`);
    }

    if (baseUrl.protocol !== "https:" || apiUrl.protocol !== "https:" ||
        baseUrl.origin !== apiUrl.origin || baseUrl.username || baseUrl.password ||
        apiUrl.username || apiUrl.password || !baseUrl.hostname.includes(".") ||
        isIP(baseUrl.hostname) || baseUrl.hostname === "localhost" ||
        baseUrl.hostname.endsWith(".localhost") || baseUrl.hostname.endsWith(".local") ||
        (baseUrl.port && baseUrl.port !== "443")) {
        throw new Error(`Unsafe wiki URL configured for ${row.source_name}.`);
    }
    if (!MISSION_CATEGORIES.has(config.category)) {
        throw new Error(`Unsupported mission category configured for ${row.source_name}.`);
    }

    const page = cleanText(config.page || row.title);
    const sourceName = cleanText(row.source_name);
    const sourceLicense = cleanText(row.source_license);
    const attribution = cleanText(row.attribution);
    if (!page || !sourceName || !sourceLicense || !attribution) {
        throw new Error(`Incomplete wiki source configuration for ${row.source_name || "game"}.`);
    }

    return {
        page,
        title: page.replaceAll("_", " "),
        category: config.category,
        group: cleanText(config.group_name) || null,
        baseUrl: baseUrl.origin,
        apiUrl: apiUrl.href,
        sourceName,
        sourceLicense,
        attribution,
        parseLists: config.parse_lists === true,
        url: `${baseUrl.origin}/wiki/${encodeURIComponent(page.replaceAll(" ", "_"))}`
    };
};

const getMissionDetails = ($, row, headers, titleCellIndex) => {
    const cells = $(row).children("td").toArray();
    let detailIndex = 1;
    return cells.map((cell, index) => {
        if (index === titleCellIndex) return null;
        const value = cleanText($(cell).text());
        if (!value) return null;
        const label = headers[detailIndex];
        detailIndex += 1;
        return label ? `${label}: ${value}` : value;
    }).filter(Boolean).join(" · ").slice(0, 2000);
};

const parseMissionPage = (html, source) => {
    const $ = cheerio.load(html);
    const wikiBaseUrl = source.baseUrl || "https://example.org";
    const sourceName = source.sourceName || "MediaWiki source";
    const sourceLicense = source.sourceLicense || "Verify source license";
    const attribution = source.attribution || `${sourceName} contributors`;
    const content = $(".mw-parser-output").first();
    if (!content.length) {
        throw new Error(`The wiki page has no parsed content: ${source.url}`);
    }

    const missions = [];
    let activeCategory = source.category || null;
    let activeGroup = null;
    let ended = false;

    const addMission = (link, row, headers = [], titleCellIndex = 0) => {
        const title = cleanText(link.text());
        const href = link.attr("href");
        if (!title || !href || !href.startsWith("/wiki/") ||
            href.startsWith("/wiki/Category:") ||
            href.startsWith("/wiki/File:")) return;

        const missionUrl = new URL(href, wikiBaseUrl).href;
        if (missions.some(mission => mission.mission_url === missionUrl)) return;
        const description = row?.is("tr")
            ? getMissionDetails($, row, headers, titleCellIndex)
            : null;
        missions.push({
            category: activeCategory,
            group_name: activeGroup,
            title,
            description: description || null,
            mission_url: missionUrl,
            source_name: sourceName,
            source_page_url: source.url,
            source_license: sourceLicense,
            attribution,
            sort_order: missions.length
        });
    };

    content.find("h2, h3, h4, table, ul li, ol li").each((_, element) => {
        if (ended) return;
        const node = $(element);
        if (element.tagName !== "table") {
            if (element.tagName === "li") {
                if (!source.parseLists || !activeCategory ||
                    node.closest("table, .navbox, .toc, .mw-references-wrap").length) {
                    return;
                }
                const link = node.find("a[href^='/wiki/']").first();
                addMission(link, null);
                return;
            }
            const heading = cleanText(
                node.find(".mw-headline").first().text() || node.text()
            );
            const normalizedHeading = normalizeTitle(heading);
            if (!heading || normalizedHeading === "contents") return;
            if ([
                "notes",
                "references",
                "external links",
                "categories",
                "languages",
                "community",
                "discussions"
            ].includes(normalizedHeading)) {
                ended = true;
                return;
            }

            const headingCategory = categoryFromHeading(heading);
            if (headingCategory) {
                activeCategory = headingCategory;
                activeGroup = source.group || heading;
            } else if (source.group) {
                activeGroup = `${source.group} · ${heading}`;
            } else {
                activeGroup = heading;
            }
            return;
        }

        if (!activeCategory ||
            node.is(".navbox, .infobox, .metadata") ||
            node.closest(".navbox, .infobox, .metadata").length) return;

        const headerRow = node.find("tr").first();
        const headers = headerRow.children("th").toArray().map(cell =>
            cleanText($(cell).text())
        );

        node.find("tr").each((__, row) => {
            const cells = $(row).children("td").toArray();
            if (!cells.length) return;

            const titleCellIndex = cells.findIndex(cell =>
                $(cell).find("a[href^='/wiki/']").length > 0
            );
            if (titleCellIndex < 0) return;
            const firstLink = $(cells[titleCellIndex])
                .find("a[href^='/wiki/']")
                .first();
            addMission(firstLink, $(row), headers, titleCellIndex);
        });
    });

    return missions;
};

const fetchMissionPage = async source => {
    const apiUrl = new URL(source.apiUrl || "/api.php", source.baseUrl);
    apiUrl.search = new URLSearchParams({
        action: "parse",
        page: source.page,
        prop: "text",
        format: "json"
    }).toString();

    let response;
    try {
        response = await fetch(apiUrl, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "GRYD game mission catalog (https://github.com/yvilram/GRYD)"
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (error) {
        const upstreamError = new Error(
            `Could not contact ${source.sourceName} (${source.title}).`,
            { cause: error }
        );
        upstreamError.upstream = true;
        throw upstreamError;
    }

    if (!response.ok) {
        const error = new Error(
            `${source.sourceName} request failed for ${source.title} (${response.status}).`
        );
        error.upstream = true;
        throw error;
    }

    let result;
    try {
        result = await response.json();
    } catch (cause) {
        const error = new Error(
            `${source.sourceName} returned invalid data for ${source.title}.`,
            { cause }
        );
        error.upstream = true;
        throw error;
    }

    const html = result?.parse?.text?.["*"];
    if (typeof html !== "string" || !html) {
        const error = new Error(
            `${source.sourceName} returned no page content for ${source.title}.`
        );
        error.upstream = true;
        throw error;
    }

    try {
        return parseMissionPage(html, source);
    } catch (cause) {
        const error = new Error(
            `Could not parse ${source.sourceName} mission list for ${source.title}.`,
            { cause }
        );
        error.upstream = true;
        throw error;
    }
};

const parseMissionArticle = (html, sourceUrl) => {
    const $ = cheerio.load(html);
    const wikiBaseUrl = new URL(sourceUrl).origin;
    const root = $(".mw-parser-output").first();
    if (!root.length) {
        throw new Error(`The wiki page has no parsed content: ${sourceUrl}`);
    }

    const excludedSections = new Set([
        "notes",
        "bugs",
        "videos",
        "references",
        "external links",
        "categories",
        "languages",
        "community",
        "discussions"
    ]);
    const content = $("<div></div>");
    let started = false;
    let ended = false;
    root.children().toArray().forEach(element => {
        if (ended) return;
        const node = $(element);
        const heading = element.tagName?.toLowerCase() === "h2"
            ? normalizeTitle(node.text().replace(/\[\s*edit\s*\]|\[\s*\]/gi, ""))
            : "";
        if (heading === "contents") return;
        if (heading && excludedSections.has(heading)) {
            ended = true;
            return;
        }
        if (heading) started = true;
        if (started) content.append(element);
    });
    if (!started) {
        root.children().toArray().forEach(element => {
            if (ended) return;
            const node = $(element);
            const heading = element.tagName?.toLowerCase() === "h2"
                ? normalizeTitle(node.text().replace(/\[\s*edit\s*\]|\[\s*\]/gi, ""))
                : "";
            if (heading === "contents") return;
            if (heading && excludedSections.has(heading)) {
                ended = true;
                return;
            }
            content.append(element);
        });
    }

    content.find("script, style, .navbox, .metadata, .printfooter").remove();
    const media = [];
    content.find("img").each((_, element) => {
        const image = $(element);
        const fileLink = image.closest("a[href^='/wiki/File:']");
        const href = fileLink.attr("href");
        const imageUrl = image.attr("data-src") || image.attr("data-original") ||
            image.attr("src");
        if (!imageUrl || imageUrl.startsWith("data:")) return;

        const fileName = image.attr("data-image-name") ||
            (href ? decodeURIComponent(href.slice("/wiki/".length)) : null);
        const style = image.attr("style") || "";
        const readDimension = name => {
            const fromAttribute = Number.parseFloat(image.attr(name));
            if (Number.isFinite(fromAttribute) && fromAttribute > 0) {
                return fromAttribute;
            }
            const fromStyle = style.match(new RegExp(`${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "i"));
            return fromStyle ? Number(fromStyle[1]) : null;
        };
        const width = readDimension("width");
        const height = readDimension("height");
        const thumbnailWidth = Number(imageUrl.match(/scale-to-width-down\/(\d+)/)?.[1]);
        const mediaIndex = media.length;
        media.push({
            type: "image",
            title: cleanText(image.attr("alt") || fileLink.text()),
            inline: Boolean(
                width && height && width <= 48 && height <= 48 ||
                Number.isFinite(thumbnailWidth) && thumbnailWidth > 0 &&
                    thumbnailWidth <= 48
            ),
            source_url: new URL(imageUrl, wikiBaseUrl).href,
            file_page_url: href
                ? new URL(href, wikiBaseUrl).href
                : image.closest("a[href]").attr("href") || null,
            file_title: fileName
                ? decodeURIComponent(fileName)
                    .replaceAll("_", " ")
                    .replace(/^File:/i, "File:")
                : null,
            license: null,
            license_url: null,
            attribution: null,
            local_url: null
        });
        image.attr("data-mission-media-index", String(mediaIndex));
    });

    content.find("video[src], video source[src], iframe[src]").each((_, element) => {
        const url = $(element).attr("src");
        if (!url) return;
        const source = new URL(url, wikiBaseUrl);
        if (source.protocol !== "https:" && source.protocol !== "http:") return;
        const fileLink = $(element).closest("figure")
            .find("a[href^='/wiki/File:']")
            .first();
        const href = fileLink.attr("href");
        const mediaIndex = media.length;
        media.push({
            type: "video",
            title: cleanText(
                $(element).attr("title") ||
                $(element).closest("figure").find("figcaption").text()
            ),
            source_url: source.href,
            file_page_url: href ? new URL(href, wikiBaseUrl).href : null,
            file_title: href
                ? decodeURIComponent(href.slice("/wiki/".length))
                    .replaceAll("_", " ")
                    .replace(/^File:/i, "File:")
                : null,
            license: null,
            license_url: null,
            attribution: null,
            local_url: null
        });
        $(element).replaceWith(
            `<span data-mission-media-index="${mediaIndex}"></span>`
        );
    });

    content.find("a[href]").each((_, element) => {
        const href = $(element).attr("href");
        if (!href || !/(youtube\.com|youtu\.be|vimeo\.com)/i.test(href)) return;
        const videoUrl = new URL(href, sourceUrl);
        if (!["http:", "https:"].includes(videoUrl.protocol) ||
            media.some(item => item.type === "video" && item.source_url === videoUrl.href) ||
            $(element).find("img").length) {
            return;
        }
        media.push({
            type: "video",
            title: cleanText($(element).text()),
            source_url: videoUrl.href,
            license: null,
            license_url: null,
            attribution: null,
            local_url: null
        });
    });

    const articleHtml = sanitizeMissionArticle($, content, sourceUrl);
    if (!cleanText(cheerio.load(articleHtml).root().text())) {
        throw new Error(`The wiki page has no readable mission content: ${sourceUrl}`);
    }

    return { html: articleHtml, media };
};

const requestWikiApi = async (
    parameters,
    description,
    wikiBaseUrl,
    configuredApiUrl
) => {
    const apiUrl = new URL(configuredApiUrl || "/api.php", wikiBaseUrl);
    apiUrl.search = new URLSearchParams({
        ...parameters,
        format: "json"
    }).toString();
    let response;
    try {
        response = await fetch(apiUrl, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "GRYD game mission catalog (https://github.com/yvilram/GRYD)"
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (cause) {
        const error = new Error(`Could not contact the wiki (${description}).`, {
            cause
        });
        error.upstream = true;
        throw error;
    }
    if (!response.ok) {
        const error = new Error(
            `Wiki request failed for ${description} (${response.status}).`
        );
        error.upstream = true;
        throw error;
    }
    try {
        const result = await response.json();
        if (result?.error) {
            const error = new Error(
                `Wiki rejected the ${description} request: ${result.error.info || result.error.code}.`
            );
            error.upstream = true;
            throw error;
        }
        return result;
    } catch (cause) {
        if (cause.upstream) throw cause;
        const error = new Error(
            `Wiki returned invalid data for ${description}.`,
            { cause }
        );
        error.upstream = true;
        throw error;
    }
};

const getMediaLicense = async (fileTitle, wikiBaseUrl, apiUrl) => {
    if (!fileTitle) return null;
    const result = await requestWikiApi({
        action: "query",
        titles: fileTitle,
        prop: "imageinfo",
        iiprop: "url|extmetadata"
    }, fileTitle, wikiBaseUrl, apiUrl);
    const page = Object.values(result?.query?.pages || {})[0];
    const info = page?.imageinfo?.[0];
    if (!info?.url) return null;
    const metadata = info?.extmetadata || {};
    const license = cleanHtmlText(metadata.LicenseShortName?.value);
    let licenseUrl = cleanHtmlText(metadata.LicenseUrl?.value);
    let distributable = false;
    try {
        const parsedLicenseUrl = new URL(licenseUrl);
        if (parsedLicenseUrl.protocol === "https:" &&
            ["creativecommons.org", "www.creativecommons.org"]
                .includes(parsedLicenseUrl.hostname) &&
            /\/(?:licenses|publicdomain)\//i.test(parsedLicenseUrl.pathname)) {
            licenseUrl = parsedLicenseUrl.href;
            distributable = LOCAL_MEDIA_LICENSE.test(license);
        }
    } catch {
        licenseUrl = "";
    }
    return {
        url: info.url,
        license: license || null,
        license_url: licenseUrl || null,
        distributable,
        attribution: cleanHtmlText(
            metadata.Attribution?.value || metadata.Artist?.value
        ) || null
    };
};

const saveLicensedMedia = async (supabase, gameId, missionId, item, license) => {
    const imageUrl = new URL(license.url);
    if (imageUrl.protocol !== "https:" ||
        !["static.wikia.nocookie.net", "images.fandom.com"].includes(imageUrl.hostname)) {
        return {
            ...item,
            license: license.license,
            license_url: license.license_url,
            attribution: license.attribution
        };
    }
    const response = await fetch(license.url, {
        headers: {
            "User-Agent": "GRYD game mission catalog (https://github.com/yvilram/GRYD)"
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`Could not download licensed mission media (${response.status}).`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_LOCAL_MEDIA_BYTES) {
        return { ...item, license: license.license, license_url: license.license_url,
            attribution: license.attribution };
    }
    const image = Buffer.from(await response.arrayBuffer());
    if (!image.length || image.length > MAX_LOCAL_MEDIA_BYTES) {
        return { ...item, license: license.license, license_url: license.license_url,
            attribution: license.attribution };
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];
    const extensionByType = {
        "image/avif": "avif",
        "image/gif": "gif",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/webm": "webm"
    };
    const extension = extensionByType[contentType];
    if (!extension) {
        return { ...item, license: license.license, license_url: license.license_url,
            attribution: license.attribution };
    }

    const digest = createHash("sha256").update(license.url).digest("hex");
    const path = `${gameId}/${missionId}/${digest}.${extension}`;
    const { error } = await supabase.storage
        .from(MISSION_MEDIA_BUCKET)
        .upload(path, image, {
            contentType,
            cacheControl: "31536000",
            upsert: true
        });
    if (error) throw error;

    const { data } = supabase.storage.from(MISSION_MEDIA_BUCKET).getPublicUrl(path);
    return {
        ...item,
        source_url: license.url,
        license: license.license,
        license_url: license.license_url,
        attribution: license.attribution,
        local_url: data.publicUrl
    };
};

const getWikiProviderForMission = (mission, configuredSources = []) => {
    let missionUrl;
    try {
        missionUrl = new URL(mission.mission_url);
    } catch {
        return null;
    }
    return configuredSources.find(source =>
        source.sourceName === mission.source_name &&
        missionUrl.protocol === "https:" &&
        missionUrl.origin === new URL(source.baseUrl).origin
    ) || null;
};

const loadGameMissionDetails = async (
    supabase,
    gameId,
    missionId
) => {
    const { data: mission, error: missionError } = await supabase
        .from("game_missions")
        .select(
            "id, category, group_name, title, description, mission_url, source_page_url, " +
            "source_name, source_license, attribution, article_content, media, " +
            "article_format, content_fetched_at, content_revision_id"
        )
        .eq("igdb_game_id", gameId)
        .eq("id", missionId)
        .eq("record_type", "mission")
        .maybeSingle();
    if (missionError) throw missionError;
    if (!mission) return null;
    if (mission.content_fetched_at &&
        mission.article_format === "structured-v3") return mission;

    const { data: sourceRows, error: sourceError } = await supabase
        .from("game_missions")
        .select(
            "title, category, group_name, mission_url, source_name, source_page_url, " +
            "source_license, attribution, content, sort_order"
        )
        .eq("igdb_game_id", gameId)
        .eq("record_type", "source")
        .order("sort_order", { ascending: true });
    if (sourceError) throw sourceError;
    const configuredSources = (sourceRows || [])
        .filter(row => row.content?.enabled !== false)
        .map(row => normalizeConfiguredSource(sourceRowToConfig(row)));
    const wikiSource = getWikiProviderForMission(mission, configuredSources);
    if (!wikiSource) {
        throw new Error("Mission source is not an enabled wiki provider.");
    }
    const missionPage = new URL(mission.mission_url);
    if (!missionPage.pathname.startsWith("/wiki/")) {
        throw new Error("Mission source URL is outside the configured wiki.");
    }
    const page = decodeURIComponent(missionPage.pathname.slice("/wiki/".length))
        .replaceAll("_", " ");
    const result = await requestWikiApi({
        action: "parse",
        page,
        prop: "text"
    }, mission.title, wikiSource.baseUrl, wikiSource.apiUrl);
    const html = result?.parse?.text?.["*"];
    if (typeof html !== "string" || !html) {
        const error = new Error(`Wiki returned no mission content for ${mission.title}.`);
        error.upstream = true;
        throw error;
    }

    let article;
    try {
        article = parseMissionArticle(html, mission.mission_url);
    } catch (cause) {
        const error = new Error(
            `Could not parse the wiki mission page for ${mission.title}.`,
            { cause }
        );
        error.upstream = true;
        throw error;
    }
    const media = [];
    for (const item of article.media) {
        if (!item.file_title) {
            media.push(item);
            continue;
        }
        let license;
        try {
            license = await getMediaLicense(
                item.file_title,
                wikiSource.baseUrl,
                wikiSource.apiUrl
            );
        } catch (error) {
            console.error(
                `Could not verify the license for mission media ${item.file_title}:`,
                error
            );
            media.push(item);
            continue;
        }
        if (!license) {
            media.push(item);
            continue;
        }
        const updatedMedia = {
            ...item,
            source_url: license.url,
            license: license.license,
            license_url: license.license_url,
            attribution: license.attribution
        };
        media.push(license.distributable
            ? await saveLicensedMedia(supabase, gameId, missionId, updatedMedia, license)
            : updatedMedia);
    }

    const $ = cheerio.load(article.html);
    $("img[data-mission-media-index], span[data-mission-media-index]").each((_, element) => {
        const index = Number($(element).attr("data-mission-media-index"));
        const item = media[index];
        if (!item || !["image", "video"].includes(item.type)) {
            $(element).remove();
            return;
        }
        if (item.type === "image") {
            $(element).attr("data-mission-media-index", String(index));
            return;
        }
        $(element).attr("data-mission-media-index", String(index));
    });
    const structuredHtml = $("body").html() || article.html;

    const content = {
        article_content: structuredHtml,
        article_format: "structured-v3",
        media,
        content_fetched_at: new Date().toISOString(),
        content_revision_id: Number.isSafeInteger(Number(result.parse.revid))
            ? Number(result.parse.revid)
            : null
    };
    content.content = toMissionContent({ ...mission, ...content });
    const { data: savedMission, error: saveError } = await supabase
        .from("game_missions")
        .update(content)
        .eq("igdb_game_id", gameId)
        .eq("id", missionId)
        .select(
            "id, category, group_name, title, description, mission_url, source_page_url, " +
            "source_name, source_license, attribution, article_content, media, " +
            "article_format, content_fetched_at, content_revision_id"
        )
        .single();
    if (saveError) throw saveError;
    return savedMission;
};

const getGameMissionDetails = (supabase, gameId, missionId) => {
    const key = `${gameId}:${missionId}`;
    if (!inFlightMissionDetails.has(key)) {
        const request = loadGameMissionDetails(
            supabase,
            gameId,
            missionId
        )
            .finally(() => inFlightMissionDetails.delete(key));
        inFlightMissionDetails.set(key, request);
    }
    return inFlightMissionDetails.get(key);
};

const toMissionContent = mission => ({
    ...(mission.content && typeof mission.content === "object" &&
        !Array.isArray(mission.content) ? mission.content : {}),
    title: mission.title,
    category: mission.category,
    group_name: mission.group_name || null,
    description: mission.description || null,
    mission_url: mission.mission_url,
    links: [
        { rel: "mission", url: mission.mission_url },
        { rel: "source", url: mission.source_page_url }
    ],
    source: {
        name: mission.source_name,
        page_url: mission.source_page_url,
        license: mission.source_license,
        attribution: mission.attribution
    },
    article_content: mission.article_content || null,
    article_format: mission.article_format || "text",
    media: Array.isArray(mission.media) ? mission.media : [],
    content_fetched_at: mission.content_fetched_at || null,
    content_revision_id: mission.content_revision_id || null
});

const sourceRowToConfig = row => ({
    ...row,
    ...(row.content && typeof row.content === "object" ? row.content : {})
});

const getConfiguredMissionSources = async (supabase, gameId) => {
    const { data, error } = await supabase
        .from("game_missions")
        .select(
            "title, category, group_name, mission_url, source_name, source_page_url, " +
            "source_license, attribution, content, sort_order"
        )
        .eq("igdb_game_id", gameId)
        .eq("record_type", "source")
        .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data || [])
        .filter(row => row.content?.enabled !== false)
        .map(row => normalizeConfiguredSource(sourceRowToConfig(row)));
};

const getCachedMissions = async (supabase, gameId, sources) => {
    const { data: cache, error: cacheError } = await supabase
        .from("game_missions")
        .select("source_name, source_page_url, source_license, attribution, content")
        .eq("igdb_game_id", gameId)
        .eq("record_type", "cache")
        .eq("mission_url", sources[0].url)
        .maybeSingle();
    if (cacheError) throw cacheError;
    if (!cache) return null;
    if (!sources.length || cache.source_page_url !== sources[0].url) return null;

    const { data: missions, error: missionsError } = await supabase
        .from("game_missions")
        .select(
            "id, category, group_name, title, description, mission_url, sort_order, " +
            "source_name, source_page_url, source_license, attribution"
        )
        .eq("igdb_game_id", gameId)
        .eq("record_type", "mission")
        .order("sort_order", { ascending: true });
    if (missionsError) throw missionsError;

    return {
        supported: true,
        missions,
        source: {
            ...cache,
            fetched_at: cache.content?.fetched_at || null,
            pages: sources.map(({ title, url }) => ({ title, url }))
        }
    };
};

const importMissions = async (supabase, gameId, sources) => {
    const pageResults = await Promise.all(sources.map(fetchMissionPage));
    const byUrl = new Map();
    pageResults.flat().forEach(mission => {
        if (!byUrl.has(mission.mission_url)) byUrl.set(mission.mission_url, mission);
    });
    const missions = [...byUrl.values()].map((mission, index) => ({
        ...mission,
        igdb_game_id: gameId,
        record_type: "mission",
        sort_order: index
    }));

    if (!missions.length) {
        const error = new Error(
            `${sources[0].sourceName} returned no mission entries.`
        );
        error.upstream = true;
        throw error;
    }

    const sourceNames = [...new Set(sources.map(source => source.sourceName))];
    const { data: existingMissions, error: existingMissionsError } = await supabase
        .from("game_missions")
        .select(
            "id, source_name, mission_url, content, article_content, article_format, " +
            "media, content_fetched_at, content_revision_id"
        )
        .eq("igdb_game_id", gameId)
        .eq("record_type", "mission")
        .in("source_name", sourceNames);
    if (existingMissionsError) throw existingMissionsError;

    const existingByUrl = new Map((existingMissions || []).map(mission => [
        `${mission.source_name}\u0000${mission.mission_url}`,
        mission
    ]));
    missions.forEach(mission => {
        const existing = existingByUrl.get(
            `${mission.source_name}\u0000${mission.mission_url}`
        );
        mission.content = toMissionContent({
            ...existing,
            ...mission,
            content: existing?.content
        });
    });

    const { error: saveMissionsError } = await supabase
        .from("game_missions")
        .upsert(missions, {
            onConflict: "igdb_game_id,record_type,source_name,mission_url"
        });
    if (saveMissionsError) throw saveMissionsError;

    const currentUrlsBySource = new Map(sourceNames.map(sourceName => [
        sourceName,
        new Set(missions
            .filter(mission => mission.source_name === sourceName)
            .map(mission => mission.mission_url))
    ]));
    const staleMissionIds = (existingMissions || [])
        .filter(mission =>
            !currentUrlsBySource.get(mission.source_name)?.has(mission.mission_url)
        )
        .map(mission => mission.id);
    if (staleMissionIds.length) {
        const { error: deleteStaleError } = await supabase
            .from("game_missions")
            .delete()
            .eq("igdb_game_id", gameId)
            .eq("record_type", "mission")
            .in("id", staleMissionIds);
        if (deleteStaleError) throw deleteStaleError;
    }

    const { data: savedMissions, error: loadMissionsError } = await supabase
        .from("game_missions")
        .select(
            "id, category, group_name, title, description, mission_url, sort_order, " +
            "source_name, source_page_url, source_license, attribution"
        )
        .eq("igdb_game_id", gameId)
        .eq("record_type", "mission")
        .order("sort_order", { ascending: true });
    if (loadMissionsError) throw loadMissionsError;

    const source = {
        source_name: sources[0].sourceName,
        source_page_url: sources[0].url,
        source_license: sources[0].sourceLicense,
        attribution: sources[0].attribution,
        fetched_at: new Date().toISOString()
    };
    const { error: saveCacheError } = await supabase
        .from("game_missions")
        .upsert({
            igdb_game_id: gameId,
            record_type: "cache",
            category: "other",
            title: source.source_name,
            mission_url: source.source_page_url,
            source_name: source.source_name,
            source_page_url: source.source_page_url,
            source_license: source.source_license,
            attribution: source.attribution,
            content: { fetched_at: source.fetched_at }
        }, {
            onConflict: "igdb_game_id,record_type,source_name,mission_url"
        });
    if (saveCacheError) throw saveCacheError;

    return {
        supported: true,
        missions: savedMissions,
        source: {
            ...source,
            pages: sources.map(({ title, url }) => ({ title, url }))
        }
    };
};

const loadGameMissions = async (supabase, game) => {
    const gameId = Number(game?.id);
    const sources = await getConfiguredMissionSources(supabase, gameId);
    if (!sources.length) {
        return { supported: false, missions: [], source: null };
    }

    const cached = await getCachedMissions(supabase, gameId, sources);
    if (cached) return cached;

    return importMissions(supabase, gameId, sources);
};

const getGameMissions = (supabase, game) => {
    const gameId = Number(game?.id);
    if (!inFlightImports.has(gameId)) {
        const request = loadGameMissions(supabase, game)
            .finally(() => inFlightImports.delete(gameId));
        inFlightImports.set(gameId, request);
    }
    return inFlightImports.get(gameId);
};

module.exports = {
    getGameMissions,
    getGameMissionDetails,
    parseMissionPage,
    parseMissionArticle
};
