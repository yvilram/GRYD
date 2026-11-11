const cheerio = require("cheerio");
const LZString = require("lz-string");

const IGN_ORIGIN = "https://www.ign.com";
const REQUEST_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_GUIDE_CONTENT_LENGTH = 100000;
const checklistsCache = new Map();
const checklistDetailsCache = new Map();
const guideCache = new Map();

const getCached = async (cache, key, load) => {
    const cached = cache.get(key);
    if (cached?.value && cached.expiresAt > Date.now()) return cached.value;
    if (cached?.promise) return cached.promise;

    const promise = load()
        .then(value => {
            cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
            return value;
        })
        .catch(error => {
            cache.delete(key);
            throw error;
        });
    cache.set(key, { promise });
    return promise;
};

const fetchHtml = async (url, fetchImpl) => {
    const response = await fetchImpl(url, {
        headers: {
            "User-Agent": "GRYD game guide catalog (https://github.com/yvilram/GRYD)",
            "Accept": "text/html,application/xhtml+xml"
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (response.status !== 200) {
        return null;
    }
    return response.text();
};

const decodeApolloStateIfAvailable = html => {
    const $ = cheerio.load(html);
    const pageData = $("#__NEXT_DATA__").html();
    if (!pageData) return null;

    let parsed;
    try {
        parsed = JSON.parse(pageData);
    } catch (error) {
        throw new Error(`IGN page data was invalid JSON: ${error.message}`);
    }

    const compressed = parsed?.props?.apolloState ??
        parsed?.props?.pageProps?.apolloState;
    if (typeof compressed !== "string" || !compressed) return null;
    const decompressed = LZString.decompressFromUTF16(compressed);
    if (!decompressed) throw new Error("Could not decompress IGN Apollo data.");
    try {
        return JSON.parse(decompressed);
    } catch (error) {
        throw new Error(`IGN Apollo data was invalid JSON: ${error.message}`);
    }
};

const decodeApolloState = html => {
    const $ = cheerio.load(html);
    const pageData = $("#__NEXT_DATA__").html();
    if (!pageData) throw new Error("IGN page did not include its Next.js data.");

    let parsed;
    try {
        parsed = JSON.parse(pageData);
    } catch (error) {
        throw new Error(`IGN page data was invalid JSON: ${error.message}`);
    }

    const compressed = parsed?.props?.apolloState ??
        parsed?.props?.pageProps?.apolloState;
    if (typeof compressed !== "string" || !compressed) {
        throw new Error("IGN page did not include Apollo data.");
    }

    const decompressed = LZString.decompressFromUTF16(compressed);
    if (!decompressed) throw new Error("Could not decompress IGN Apollo data.");

    try {
        return JSON.parse(decompressed);
    } catch (error) {
        throw new Error(`IGN Apollo data was invalid JSON: ${error.message}`);
    }
};

const resolveReference = (apollo, value) => {
    if (typeof value?.__ref !== "string") return value || null;
    return apollo[value.__ref] || null;
};

const findEntities = (apollo, type) => Object.entries(apollo)
    .filter(([, value]) => value?.__typename === type)
    .map(([apolloKey, value]) => ({ apolloKey, value }));

const findEntity = (apollo, type, id) => {
    const directKey = `${type}:${id}`;
    if (apollo[directKey]?.__typename === type) {
        return { apolloKey: directKey, value: apollo[directKey] };
    }
    return findEntities(apollo, type)
        .find(entity => String(entity.value.id) === String(id)) || null;
};

const createIGNUrl = (value, gameSlug, requiredPrefix) => {
    if (typeof value !== "string" || !value) return null;
    try {
        const url = new URL(value, IGN_ORIGIN);
        if (url.protocol !== "https:" ||
            url.origin !== IGN_ORIGIN ||
            !url.pathname.startsWith(`${requiredPrefix}/${gameSlug}/`)) {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
};

const createIGNWikiUrl = value => {
    if (typeof value !== "string" || !value) return null;
    try {
        const url = new URL(value, IGN_ORIGIN);
        if (url.protocol !== "https:" ||
            url.origin !== IGN_ORIGIN ||
            !/^\/wikis\/[a-z0-9]+(?:-[a-z0-9]+)*\/.+/.test(url.pathname)) {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
};

const listChecklists = (apollo, gameSlug) => {
    const checklists = new Map();
    for (const { value } of findEntities(apollo, "Checklist")) {
        if (typeof value.slug !== "string" ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) ||
            typeof value.name !== "string" ||
            !value.name.trim()) {
            continue;
        }
        const url = createIGNUrl(
            `/games/${gameSlug}/checklists/${value.slug}`,
            gameSlug,
            `/games`
        );
        if (!url || checklists.has(value.slug)) continue;

        const category = resolveReference(apollo, value.category);
        checklists.set(value.slug, {
            id: value.id,
            name: value.name.trim(),
            slug: value.slug,
            url,
            imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : null,
            taskCount: Number.isSafeInteger(Number(value.taskCount))
                ? Number(value.taskCount)
                : 0,
            category: category?.name || null
        });
    }
    return [...checklists.values()];
};

const parseChecklistTasks = (apollo, checklist, gameSlug) => {
    const rawChecklist = findEntities(apollo, "Checklist")
        .find(entity => entity.value.slug === checklist.slug)?.value;
    if (!rawChecklist) throw new Error("IGN checklist data was not found.");

    const tasks = [];
    const missingTaskIds = [];
    const missingGroupIds = [];
    for (const join of Array.isArray(rawChecklist.taskJoins)
        ? rawChecklist.taskJoins
        : []) {
        const taskId = Number(join.checklistTaskId);
        const taskEntity = findEntity(apollo, "ChecklistTask", taskId);
        if (!taskEntity) {
            missingTaskIds.push(taskId);
            continue;
        }

        const groupEntity = join.checklistGroupId == null
            ? null
            : findEntity(apollo, "ChecklistGroup", join.checklistGroupId);
        if (join.checklistGroupId != null && !groupEntity) {
            missingGroupIds.push(Number(join.checklistGroupId));
        }

        const task = taskEntity.value;
        const guidePages = (Array.isArray(task.guidePages) ? task.guidePages : [])
            .map(page => ({
                title: typeof page.title === "string" ? page.title : "Guide",
                url: createIGNWikiUrl(page.wikiUrl)
            }))
            .filter(page => page.url);
        const videos = (Array.isArray(task.videos) ? task.videos : [])
            .map(videoReference => {
                const taskVideo = resolveReference(apollo, videoReference);
                const video = resolveReference(apollo, taskVideo?.video);
                return {
                    taskVideo,
                    content: resolveReference(apollo, video?.content)
                };
            })
            .filter(Boolean)
            .map(({ taskVideo, content }) => {
                const url = typeof content?.url === "string" ? content.url : null;
                let safeUrl = null;
                try {
                    const parsedUrl = new URL(url);
                    if (parsedUrl.protocol === "https:" &&
                        ["www.ign.com", "ign.com", "www.youtube.com",
                            "youtube.com", "youtu.be", "player.vimeo.com"]
                            .includes(parsedUrl.hostname)) {
                        safeUrl = parsedUrl.href;
                    }
                } catch {
                    safeUrl = null;
                }
                return safeUrl
                    ? {
                        title: content.title || "Video guide",
                        url: safeUrl,
                        start: Number.isFinite(taskVideo?.start)
                            ? taskVideo.start
                            : null,
                        end: Number.isFinite(taskVideo?.end)
                            ? taskVideo.end
                            : null
                    }
                    : null;
            })
            .filter(Boolean);

        tasks.push({
            id: task.id,
            name: typeof task.name === "string" ? task.name : "Untitled task",
            group: groupEntity?.value?.name || null,
            guidePages,
            map: task.map?.mapName
                ? {
                    name: task.map.mapName,
                    url: createIGNUrl(task.mapUrl, gameSlug, "/maps")
                }
                : null,
            videos
        });
    }

    return {
        checklist: {
            ...checklist,
            taskCount: rawChecklist.taskCount ?? checklist.taskCount
        },
        tasks,
        complete: tasks.length === (rawChecklist.taskJoins || []).length &&
            missingTaskIds.length === 0 &&
            missingGroupIds.length === 0,
        missingTaskIds,
        missingGroupIds,
        source: {
            name: "IGN",
            attribution: "Checklist and guide content provided by IGN.",
            url: checklist.url
        }
    };
};

const getSafeIGNImageUrl = (image, sourceUrl) => {
    const candidates = [
        image.attr("data-original"),
        image.attr("data-src"),
        image.attr("data-lazy-src"),
        image.attr("src")
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            const url = new URL(candidate, sourceUrl);
            if (url.protocol === "https:" &&
                (url.hostname === "ign.com" ||
                    url.hostname.endsWith(".ign.com") ||
                    url.hostname.endsWith(".ignimgs.com"))) {
                return url.href;
            }
        } catch {
            continue;
        }
    }
    return null;
};

const escapeHTMLAttribute = value => String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const sanitizeIGNArticle = (content, sourceUrl) => {
    const allowedTags = new Set([
        "a", "b", "blockquote", "br", "caption", "code", "dd", "div", "dl",
        "dt", "em", "h2", "h3", "h4", "h5", "hr", "i", "img", "li", "ol",
        "p", "pre", "small", "span", "strong", "sub", "sup", "table", "tbody",
        "td", "th", "thead", "tr", "u", "ul"
    ]);
    const $ = cheerio.load(`<div>${content.html() || ""}</div>`);
    const article = $("div").first();

    article.find([
        "script", "style", "iframe", "object", "video", "svg", "form", "input",
        "button", ".mw-editsection", ".toc", ".portable-infobox", ".references",
        ".mw-references-wrap", "noscript"
    ].join(",")).remove();

    article.find("*").toArray().reverse().forEach(element => {
        const node = $(element);
        const tag = element.tagName?.toLowerCase();
        if (!tag) return;
        if (!allowedTags.has(tag)) {
            node.replaceWith(node.contents());
            return;
        }

        const href = tag === "a" ? node.attr("href") : null;
        const src = tag === "img" ? getSafeIGNImageUrl(node, sourceUrl) : null;
        const alt = tag === "img" ? node.attr("alt") || "" : null;
        const mediaIndex = tag === "span"
            ? node.attr("data-mission-media-index")
            : null;
        Object.keys(element.attribs || {}).forEach(attribute => node.removeAttr(attribute));

        if (tag === "span" && /^\d+$/.test(mediaIndex || "")) {
            node.attr("data-mission-media-index", mediaIndex);
        }
        if (tag === "a" && href) {
            try {
                const url = new URL(href, sourceUrl);
                if (url.protocol === "https:" || url.protocol === "http:") {
                    if (url.hostname === "ign.com") url.hostname = "www.ign.com";
                    node.attr("href", url.href);
                    node.attr("target", "_blank");
                    node.attr("rel", "noopener noreferrer");
                }
            } catch {
                node.removeAttr("href");
            }
        }
        if (tag === "img" && src) {
            node.attr("src", src);
            node.attr("alt", alt);
            node.attr("loading", "lazy");
            node.attr("referrerpolicy", "no-referrer");
        } else if (tag === "img") {
            node.remove();
        }
    });
    return article.html() || "";
};

const cleanText = value => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const decodeFragment = fragment => {
    try {
        return decodeURIComponent(fragment);
    } catch {
        return fragment;
    }
};

const findFragmentElement = (root, fragment) => {
    if (!fragment) return null;
    const expected = decodeFragment(fragment);
    return root.find("[id]").toArray().find(element => {
        const id = element.attribs?.id;
        return id === fragment || decodeFragment(id || "") === expected;
    }) || null;
};

const headingLevel = element => {
    const match = element?.tagName?.match(/^h([1-6])$/i);
    return match ? Number(match[1]) : null;
};

const extractFragmentSection = ($, target) => {
    const headings = "h1, h2, h3, h4, h5, h6";
    let start = headingLevel(target) ? $(target) : $(target).closest(headings);
    if (!start.length) start = $(target).prevAll(headings).first();
    if (!start.length) {
        const container = $(target).closest("section, article, main, .content");
        return container.length ? container.first().clone() : $(target).parent().clone();
    }

    const level = headingLevel(start.get(0));
    const section = $("<div></div>").append(start.clone());
    let sibling = start.next();
    while (sibling.length) {
        const nextLevel = headingLevel(sibling.get(0));
        if (nextLevel && nextLevel <= level) break;
        section.append(sibling.clone());
        sibling = sibling.next();
    }
    return section;
};

const extractGuideSections = ($, root) => {
    const sections = [];
    let current = null;
    root.find("h1, h2, h3, h4, h5, h6, p, li").each((_, element) => {
        const tag = element.tagName.toLowerCase();
        const text = cleanText($(element).text());
        if (!text) return;
        if (/^h[1-6]$/.test(tag)) {
            current = { level: Number(tag.slice(1)), title: text, paragraphs: [] };
            sections.push(current);
            return;
        }
        if (tag === "li" && $(element).children("ul, ol").length) return;
        if (!current) {
            current = { level: null, title: null, paragraphs: [] };
            sections.push(current);
        }
        if (!current.paragraphs.includes(text)) current.paragraphs.push(text);
    });
    return sections.filter(section => section.title || section.paragraphs.length);
};

const extractGuideLinks = ($, root, sourceUrl) => {
    const seen = new Set();
    return root.find("a[href]").toArray().flatMap(element => {
        try {
            const url = new URL($(element).attr("href"), sourceUrl);
            if (!["https:", "http:"].includes(url.protocol) || seen.has(url.href)) {
                return [];
            }
            seen.add(url.href);
            return [{ text: cleanText($(element).text()) || null, url: url.href }];
        } catch {
            return [];
        }
    });
};

const extractGuideImages = ($, root, sourceUrl) => {
    const seen = new Set();
    return root.find("img").toArray().flatMap(element => {
        const image = $(element);
        const url = getSafeIGNImageUrl(image, sourceUrl);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        return [{
            url,
            alt: cleanText(image.attr("alt")) || null,
            title: cleanText(image.attr("title")) || null
        }];
    });
};

const findIGNWikiPage = (apollo, sourceUrl) => {
    const pageSlug = decodeURIComponent(
        new URL(sourceUrl).pathname.split("/").pop() || ""
    );
    return findEntities(apollo, "WikiPage")
        .find(({ value }) => {
            const id = typeof value.id === "string" ? value.id : "";
            return id.endsWith(`:${pageSlug}`) &&
                Array.isArray(value.htmlEntities);
        })?.value || null;
};

const createIGNWikiPageMarkup = (wikiPage, sourceUrl) => {
    const content = wikiPage.htmlEntities.map(element => {
        if (element.name === "html" &&
            typeof element.values?.html === "string") {
            return element.values.html;
        }
        if (element.name === "image" && Array.isArray(element.values)) {
            return element.values.map(image => {
                if (!image || typeof image !== "object") return "";
                const url = getSafeIGNImageUrl({
                    attr: name => name === "data-original"
                        ? image.original
                        : name === "src" ? image.src : null
                }, sourceUrl);
                if (!url) return "";
                const alt = typeof image.alt === "string" ? image.alt : "";
                return `<img src="${escapeHTMLAttribute(url)}" alt="${escapeHTMLAttribute(alt)}">`;
            }).join("");
        }
        if (element.name === "video" &&
            typeof element.values?.slug === "string" &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(element.values.slug)) {
            return `<span data-ign-video-slug="${element.values.slug}"></span>`;
        }
        return "";
    }).join("");
    return `<div class="wiki-html">${content}</div>`;
};

const extractIGNGuideContent = (html, sourceUrl) => {
    const apollo = decodeApolloStateIfAvailable(html);
    const wikiPage = apollo ? findIGNWikiPage(apollo, sourceUrl) : null;
    const $ = cheerio.load(
        wikiPage ? createIGNWikiPageMarkup(wikiPage, sourceUrl) : html
    );
    const wikiContent = [
        ".wiki-html",
        ".wiki-content",
        ".article-content",
        ".wiki-page-content",
        ".content-main",
        "article",
        "main",
        "#content",
        "body"
    ].map(selector => $(selector).first())
        .find(candidate => candidate.length && cleanText(candidate.text()));
    if (!wikiContent?.length) throw new Error("IGN guide article content was not found.");

    const fragment = new URL(sourceUrl).hash.slice(1);
    const fragmentElement = findFragmentElement(wikiContent, fragment);
    let article = fragmentElement
        ? extractFragmentSection($, fragmentElement)
        : wikiContent.clone();
    if (!article.length) article = wikiContent.clone();

    const videoSlugs = article.find("[data-ign-video-slug]").toArray()
        .map((element, index) => {
            const slug = element.attribs?.["data-ign-video-slug"];
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || "")) return null;
            $(element).attr("data-mission-media-index", String(index));
            $(element).removeAttr("data-ign-video-slug");
            return slug;
        })
        .filter(Boolean);

    article.find([
        "script", "style", "noscript", "iframe", "svg", "form", "button", "nav",
        "aside", "footer", ".advertisement", ".ad", ".ad-container", ".newsletter",
        ".social-share", ".related-content", ".table-of-contents", ".toc",
        ".portable-infobox", ".references", ".mw-references-wrap", ".mw-editsection"
    ].join(",")).remove();

    const text = cleanText(article.text()).slice(0, MAX_GUIDE_CONTENT_LENGTH);
    const sections = extractGuideSections($, article);
    const links = extractGuideLinks($, article, sourceUrl);
    const images = extractGuideImages($, article, sourceUrl);
    const articleContent = sanitizeIGNArticle(article, sourceUrl);
    return {
        pageTitle: wikiPage?.title ||
            cleanText($("h1").first().text()) ||
            cleanText($("title").first().text()) || null,
        fragment: fragment || null,
        fragmentFound: Boolean(fragmentElement),
        extractionMethod: fragmentElement ? "fragment" : "article-fallback",
        text,
        sections,
        links,
        images,
        videoSlugs,
        articleContent
    };
};

const getIGNVideoContent = async (slug, fetchImpl) => {
    const videoUrl = `${IGN_ORIGIN}/videos/${slug}`;
    const html = await fetchHtml(videoUrl, fetchImpl);
    if (!html) {
        return {
            type: "video",
            title: slug.replaceAll("-", " "),
            source_url: videoUrl
        };
    }

    const apollo = decodeApolloState(html);
    const video = findEntities(apollo, "ModernVideo")[0]?.value;
    const videoContent = resolveReference(apollo, video?.content);
    const media = Array.isArray(video?.assets)
        ? video.assets.flatMap(asset => {
            if (typeof asset?.url !== "string" ||
                !Number.isSafeInteger(asset.width)) return [];
            try {
                const url = new URL(asset.url);
                if (url.protocol !== "https:" ||
                    !/^assets\d*\.ign\.com$/.test(url.hostname) ||
                    !/\.mp4$/i.test(url.pathname)) {
                    return [];
                }
                return [{ url: url.href, width: asset.width }];
            } catch {
                return [];
            }
        })
        : [];
    media.sort((left, right) => right.width - left.width);

    return {
        type: "video",
        title: videoContent?.title || slug.replaceAll("-", " "),
        source_url: media[0]?.url || videoUrl,
        format: media.length ? "mp4" : "ign"
    };
};

const loadChecklistIndex = async (gameSlug, fetchImpl) => {
    const html = await fetchHtml(
        `${IGN_ORIGIN}/games/${gameSlug}/checklists`,
        fetchImpl
    );
    if (!html) return { game: gameSlug, total: 0, checklists: [] };
    const checklists = listChecklists(decodeApolloState(html), gameSlug);
    return { game: gameSlug, total: checklists.length, checklists };
};

const getIGNChecklists = (gameSlug, fetchImpl = fetch) =>
    getCached(checklistsCache, gameSlug, () =>
        loadChecklistIndex(gameSlug, fetchImpl)
    );

const getIGNChecklistDetails = async (
    gameSlug,
    checklistSlug,
    fetchImpl = fetch
) => {
    const cacheKey = `${gameSlug}/${checklistSlug}`;
    return getCached(checklistDetailsCache, cacheKey, async () => {
        const index = await getIGNChecklists(gameSlug, fetchImpl);
        const checklist = index.checklists.find(item => item.slug === checklistSlug);
        if (!checklist) return null;

        const html = await fetchHtml(checklist.url, fetchImpl);
        if (!html) return null;
        return parseChecklistTasks(decodeApolloState(html), checklist, gameSlug);
    });
};

const getIGNChecklistGuide = async (
    gameSlug,
    checklistSlug,
    taskId,
    guideIndex,
    fetchImpl = fetch
) => {
    const cacheKey = `${gameSlug}/${checklistSlug}/${taskId}/${guideIndex}`;
    return getCached(guideCache, cacheKey, async () => {
        const details = await getIGNChecklistDetails(
            gameSlug,
            checklistSlug,
            fetchImpl
        );
        const task = details?.tasks.find(item => String(item.id) === String(taskId));
        const guide = task?.guidePages[guideIndex];
        if (!guide) return null;

        const wikiSlug = new URL(guide.url).pathname.split("/")[2];
        const page = await getIGNWikiPage(wikiSlug, guide.url, fetchImpl);
        if (!page) return null;
        return {
            title: guide.title,
            task: task.name,
            url: guide.url,
            ...page,
            attribution: "Guide content provided by IGN.",
            sourceName: "IGN"
        };
    });
};

const getIGNContentPage = async (url, fetchImpl = fetch) => {
    let pageUrl;
    try {
        pageUrl = new URL(url);
    } catch {
        throw new Error("IGN page URL is invalid.");
    }
    if (pageUrl.protocol !== "https:" || pageUrl.origin !== IGN_ORIGIN) {
        throw new Error("IGN page URL is not allowed.");
    }

    const html = await fetchHtml(pageUrl.href, fetchImpl);
    if (!html) return null;
    const content = extractIGNGuideContent(html, pageUrl.href);
    const videos = await Promise.all(
        content.videoSlugs.map(slug => getIGNVideoContent(slug, fetchImpl))
    );
    const pageName = decodeURIComponent(pageUrl.pathname.split("/").pop() || "")
        .replaceAll("_", " ");
    const { videoSlugs, ...pageContent } = content;
    return {
        title: pageContent.pageTitle || pageName,
        url: pageUrl.href,
        ...pageContent,
        videos,
        attribution: "Guide content provided by IGN.",
        sourceName: "IGN"
    };
};

const getIGNWikiPage = async (gameSlug, url, fetchImpl = fetch) => {
    const pageUrl = new URL(url);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gameSlug || "") ||
        !pageUrl.pathname.startsWith(`/wikis/${gameSlug}/`)) {
        throw new Error("IGN wiki page URL is not allowed.");
    }
    return getIGNContentPage(pageUrl.href, fetchImpl);
};

module.exports = {
    getIGNChecklists,
    getIGNChecklistDetails,
    getIGNChecklistGuide,
    getIGNWikiPage,
    getIGNContentPage,
    decodeApolloState,
    parseChecklistTasks,
    sanitizeIGNArticle,
    extractIGNGuideContent
};
