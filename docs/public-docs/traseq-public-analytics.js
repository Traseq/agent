(function () {
  'use strict';

  if (
    typeof window === 'undefined' ||
    window.__traseqDocsPublicAnalyticsLoaded
  ) {
    return;
  }

  window.__traseqDocsPublicAnalyticsLoaded = true;

  var GA_MEASUREMENT_ID = 'G-FJR5GWPHNV';
  var CLARITY_PROJECT_ID = 'w80mqy1i36';
  var CONSENT_STORAGE_KEY = 'traseq-public-cookie-consent';
  var CONSENT_COOKIE_KEY = 'traseq_public_cookie_consent';
  var CONSENT_VERSION = 1;
  var CONSENT_STATES = {
    UNDECIDED: 'undecided',
    GRANTED: 'granted',
    DENIED: 'denied',
  };
  var ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
  var PRODUCTION_ANALYTICS_HOSTS = {
    'docs.traseq.com': true,
  };
  var APP_HOSTS = {
    'app.traseq.com': true,
  };
  var DEFAULT_CONSENT = {
    version: CONSENT_VERSION,
    consent: CONSENT_STATES.UNDECIDED,
    consentTimestamp: null,
    categories: {
      analytics: false,
      sessionReplay: false,
    },
  };

  var ui = {
    root: null,
    banner: null,
    manageButton: null,
    modal: null,
    analyticsToggle: null,
    sessionReplayToggle: null,
  };
  var preferencesOpen = false;
  var consentState = null;
  var gaBootstrapped = false;
  var clarityLoadPromise = null;
  var lastTrackedSignature = '';
  var lastTrackedLocation = '';
  var lastClarityPageSignature = '';
  var pendingRouteTimer = null;
  var lastObservedPath = '';
  var CLARITY_SCRIPT_ID = 'traseq-docs-clarity-script';
  var SESSION_REPLAY_ELIGIBLE_GROUPS = {
    docs_guides: true,
    docs_tutorials: true,
    docs_learn: true,
  };

  function safeJsonParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  function cleanObject(input) {
    var next = {};
    var keys = Object.keys(input);

    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var value = input[key];

      if (value === undefined || value === null || value === '') {
        continue;
      }

      next[key] = value;
    }

    return next;
  }

  function normalizePathname(pathname) {
    if (!pathname || pathname === '/') {
      return '/';
    }

    return pathname.replace(/\/+$/, '') || '/';
  }

  function getPathSignature() {
    return normalizePathname(window.location.pathname) + window.location.search;
  }

  function getSharedCookieDomain() {
    var hostname = window.location.hostname;

    if (hostname === 'traseq.com' || hostname.endsWith('.traseq.com')) {
      return '.traseq.com';
    }

    return null;
  }

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split(';') : [];

    for (var i = 0; i < parts.length; i += 1) {
      var entry = parts[i].trim();
      if (!entry) {
        continue;
      }

      var separatorIndex = entry.indexOf('=');
      var cookieName =
        separatorIndex >= 0 ? entry.slice(0, separatorIndex) : entry;

      if (cookieName !== name) {
        continue;
      }

      var cookieValue =
        separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : '';

      try {
        return decodeURIComponent(cookieValue);
      } catch (_error) {
        return cookieValue;
      }
    }

    return null;
  }

  function writeCookie(name, value, maxAgeSeconds) {
    var segments = [
      name + '=' + encodeURIComponent(value),
      'Path=/',
      'Max-Age=' + String(maxAgeSeconds),
      'SameSite=Lax',
    ];
    var sharedDomain = getSharedCookieDomain();

    if (sharedDomain) {
      segments.push('Domain=' + sharedDomain);
    }

    if (window.location.protocol === 'https:') {
      segments.push('Secure');
    }

    document.cookie = segments.join('; ');
  }

  function deleteCookie(name, domain) {
    var segments = [
      name + '=',
      'Path=/',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'SameSite=Lax',
    ];

    if (domain) {
      segments.push('Domain=' + domain);
    }

    if (window.location.protocol === 'https:') {
      segments.push('Secure');
    }

    document.cookie = segments.join('; ');
  }

  function readLocalConsent() {
    try {
      return normalizeConsent(
        safeJsonParse(window.localStorage.getItem(CONSENT_STORAGE_KEY)),
      );
    } catch (_error) {
      return null;
    }
  }

  function writeLocalConsent(state) {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function readCookieConsent() {
    var raw = readCookie(CONSENT_COOKIE_KEY);
    return raw ? normalizeConsent(safeJsonParse(raw)) : null;
  }

  function normalizeConsent(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    var categories = raw.categories || {};
    var analytics = categories.analytics === true;
    var sessionReplay = categories.sessionReplay === true;
    var consentTimestamp =
      typeof raw.consentTimestamp === 'number' ? raw.consentTimestamp : null;
    var consent = raw.consent;

    if (
      consent !== CONSENT_STATES.GRANTED &&
      consent !== CONSENT_STATES.DENIED &&
      consent !== CONSENT_STATES.UNDECIDED
    ) {
      consent =
        analytics || sessionReplay
          ? CONSENT_STATES.GRANTED
          : CONSENT_STATES.DENIED;
    }

    if (consent === CONSENT_STATES.UNDECIDED) {
      analytics = false;
      sessionReplay = false;
    }

    if (!analytics && !sessionReplay && consent === CONSENT_STATES.GRANTED) {
      consent = CONSENT_STATES.DENIED;
    }

    return {
      version: CONSENT_VERSION,
      consent: consent,
      consentTimestamp: consentTimestamp,
      categories: {
        analytics: analytics,
        sessionReplay: sessionReplay,
      },
    };
  }

  function pickNewestConsent(first, second) {
    if (!first) {
      return second;
    }

    if (!second) {
      return first;
    }

    return (second.consentTimestamp || 0) > (first.consentTimestamp || 0)
      ? second
      : first;
  }

  function loadConsentState() {
    var resolved = pickNewestConsent(readLocalConsent(), readCookieConsent());

    if (!resolved) {
      return cloneConsent(DEFAULT_CONSENT);
    }

    return resolved;
  }

  function cloneConsent(state) {
    return {
      version: CONSENT_VERSION,
      consent: state.consent,
      consentTimestamp: state.consentTimestamp,
      categories: {
        analytics: !!state.categories.analytics,
        sessionReplay: !!state.categories.sessionReplay,
      },
    };
  }

  function persistConsentState(state) {
    writeLocalConsent(state);
    writeCookie(CONSENT_COOKIE_KEY, JSON.stringify(state), ONE_YEAR_SECONDS);
  }

  function deriveConsentFromCategories(categories) {
    return categories.analytics || categories.sessionReplay
      ? CONSENT_STATES.GRANTED
      : CONSENT_STATES.DENIED;
  }

  function setConsentCategories(categories) {
    consentState = {
      version: CONSENT_VERSION,
      consent: deriveConsentFromCategories(categories),
      consentTimestamp: Date.now(),
      categories: {
        analytics: !!categories.analytics,
        sessionReplay: !!categories.sessionReplay,
      },
    };

    persistConsentState(consentState);
    applyConsentState();
  }

  function denyConsent() {
    consentState = {
      version: CONSENT_VERSION,
      consent: CONSENT_STATES.DENIED,
      consentTimestamp: Date.now(),
      categories: {
        analytics: false,
        sessionReplay: false,
      },
    };

    persistConsentState(consentState);
    applyConsentState();
  }

  function isAnalyticsConsentGranted() {
    return !!(consentState && consentState.categories.analytics);
  }

  function isSessionReplayConsentGranted() {
    return !!(consentState && consentState.categories.sessionReplay);
  }

  function isSessionReplayHostEnabled() {
    return !!PRODUCTION_ANALYTICS_HOSTS[window.location.hostname];
  }

  function isSessionReplayAvailable() {
    return isSessionReplayHostEnabled() && !!CLARITY_PROJECT_ID;
  }

  function isAnyOptionalTrackingGranted() {
    return isAnalyticsConsentGranted() || isSessionReplayConsentGranted();
  }

  function isAnalyticsHostEnabled() {
    return !!PRODUCTION_ANALYTICS_HOSTS[window.location.hostname];
  }

  function deleteVisibleGaCookies() {
    var cookies = document.cookie ? document.cookie.split(';') : [];
    var cookieNames = {};
    var sharedDomain = getSharedCookieDomain();

    for (var i = 0; i < cookies.length; i += 1) {
      var entry = cookies[i].trim();
      if (!entry) {
        continue;
      }

      var name = entry.split('=')[0];
      if (!name || name.indexOf('_ga') !== 0 || cookieNames[name]) {
        continue;
      }

      cookieNames[name] = true;
      deleteCookie(name, null);

      if (sharedDomain) {
        deleteCookie(name, sharedDomain);
      }
    }
  }

  function ensureGtag() {
    if (typeof window.gtag === 'function') {
      return;
    }

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  function bootstrapGa() {
    if (!isAnalyticsHostEnabled() || !GA_MEASUREMENT_ID) {
      return;
    }

    ensureGtag();
    window['ga-disable-' + GA_MEASUREMENT_ID] = false;

    if (!gaBootstrapped) {
      window.gtag('js', new Date());
      window.gtag('consent', 'default', {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      });
      window.gtag('set', 'allow_google_signals', false);
      window.gtag('set', 'allow_ad_personalization_signals', false);
      window.gtag('config', GA_MEASUREMENT_ID, {
        send_page_view: false,
        anonymize_ip: true,
      });

      var script = document.createElement('script');
      script.async = true;
      script.src =
        'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
      document.head.appendChild(script);
      gaBootstrapped = true;
    }

    window.gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  }

  function disableGa() {
    if (GA_MEASUREMENT_ID) {
      window['ga-disable-' + GA_MEASUREMENT_ID] = true;
    }

    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      });
    }

    deleteVisibleGaCookies();
  }

  function bootstrapClarityQueue() {
    if (typeof window.clarity === 'function') {
      return;
    }

    var clarity = function clarity() {
      clarity.q = clarity.q || [];
      clarity.q.push(arguments);
    };

    window.clarity = clarity;
  }

  function ensureClarityLoaded() {
    if (!isSessionReplayAvailable()) {
      return Promise.resolve();
    }

    bootstrapClarityQueue();

    if (document.getElementById(CLARITY_SCRIPT_ID)) {
      return clarityLoadPromise || Promise.resolve();
    }

    clarityLoadPromise =
      clarityLoadPromise ||
      new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.id = CLARITY_SCRIPT_ID;
        script.async = true;
        script.src = 'https://www.clarity.ms/tag/' + CLARITY_PROJECT_ID;
        script.onload = function () {
          resolve();
        };
        script.onerror = function () {
          script.remove();
          clarityLoadPromise = null;
          reject(new Error('Failed to load Microsoft Clarity'));
        };
        document.head.appendChild(script);
      });

    return clarityLoadPromise;
  }

  function updateClarityConsent(consent) {
    if (typeof window.clarity !== 'function') {
      return;
    }

    window.clarity('consentv2', {
      ad_Storage: 'denied',
      analytics_Storage: consent,
    });

    if (consent === 'denied') {
      window.clarity('consent', false);
    }
  }

  function toIdentifier(segment) {
    return String(segment || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function getCanonicalUrl() {
    var canonical = document.querySelector('link[rel="canonical"]');
    var href = canonical && canonical.getAttribute('href');

    if (href) {
      return href;
    }

    return window.location.origin + normalizePathname(window.location.pathname);
  }

  function getPageLocale(pathname) {
    return pathname === '/zh-hant' || pathname.indexOf('/zh-hant/') === 0
      ? 'zh-Hant'
      : 'en';
  }

  function stripLocalePrefix(pathname) {
    if (pathname === '/zh-hant') {
      return '/';
    }

    if (pathname.indexOf('/zh-hant/') === 0) {
      return pathname.slice('/zh-hant'.length) || '/';
    }

    return pathname;
  }

  function getContentGroup(basePath) {
    if (basePath === '/') {
      return 'docs_home';
    }

    var segments = basePath.split('/').filter(Boolean);
    var primary = segments[0] || 'home';
    var secondary = segments[1] || '';

    if (primary === 'guides' && secondary === 'tutorials') {
      return 'docs_tutorials';
    }

    if (primary === 'guides') {
      return 'docs_guides';
    }

    if (primary === 'api-reference' || primary === 'openapi') {
      return 'docs_api_reference';
    }

    if (primary === 'reference') {
      return 'docs_reference';
    }

    if (primary === 'legal') {
      return 'docs_legal';
    }

    if (primary === 'changelog') {
      return 'docs_changelog';
    }

    return 'docs_' + toIdentifier(primary || 'page');
  }

  function getContentId(basePath) {
    if (basePath === '/') {
      return 'docs_index';
    }

    return basePath
      .split('/')
      .filter(Boolean)
      .map(function (segment) {
        return toIdentifier(segment);
      })
      .join('_');
  }

  function getArticleSlug(basePath) {
    if (basePath === '/') {
      return 'index';
    }

    var segments = basePath.split('/').filter(Boolean);
    return toIdentifier(segments[segments.length - 1] || 'index');
  }

  function getPageReferrer() {
    if (lastTrackedLocation) {
      return lastTrackedLocation;
    }

    var rawReferrer = document.referrer || '';

    if (!rawReferrer) {
      return undefined;
    }

    try {
      var referrerUrl = new URL(rawReferrer);
      return referrerUrl.origin === window.location.origin
        ? undefined
        : referrerUrl.toString();
    } catch (_error) {
      return rawReferrer;
    }
  }

  function buildPageContext() {
    var pathname = normalizePathname(window.location.pathname);
    var basePath = stripLocalePrefix(pathname);
    var pageLocation =
      window.location.origin + pathname + window.location.search;
    var contentId = getContentId(basePath);
    var contentGroup = getContentGroup(basePath);

    return cleanObject({
      entry_surface: 'docs',
      entry_source:
        contentId === 'docs_index' ? 'docs_index' : 'docs_' + contentId,
      content_id: contentId,
      content_type: 'docs_page',
      content_group: contentGroup,
      article_slug: getArticleSlug(basePath),
      page_locale: getPageLocale(pathname),
      page_path: pathname,
      page_location: pageLocation,
      canonical_url: getCanonicalUrl(),
      page_title: document.title || undefined,
      page_referrer: getPageReferrer(),
      transport_type: 'beacon',
    });
  }

  function isSessionReplayEligiblePage(pageContext) {
    return !!(
      pageContext && SESSION_REPLAY_ELIGIBLE_GROUPS[pageContext.content_group]
    );
  }

  function setClarityPageContext(pageContext) {
    if (typeof window.clarity !== 'function' || !pageContext) {
      return;
    }

    window.clarity('set', 'surface', 'docs');
    window.clarity('set', 'content_id', pageContext.content_id || 'docs_index');
    window.clarity(
      'set',
      'content_group',
      pageContext.content_group || 'docs_page',
    );
    window.clarity('set', 'article_slug', pageContext.article_slug || 'index');
    window.clarity('set', 'page_locale', pageContext.page_locale || 'en');
    window.clarity('set', 'page_path', pageContext.page_path || '/');
    window.clarity(
      'set',
      'entry_source',
      pageContext.entry_source || 'docs_index',
    );
  }

  function applyClarityState(pageContext) {
    if (
      !isSessionReplayAvailable() ||
      !isSessionReplayConsentGranted() ||
      !isSessionReplayEligiblePage(pageContext)
    ) {
      updateClarityConsent('denied');
      lastClarityPageSignature = '';
      return;
    }

    ensureClarityLoaded()
      .then(function () {
        updateClarityConsent('granted');
        setClarityPageContext(pageContext);

        var claritySignature =
          (pageContext.page_location || '') +
          '|' +
          (pageContext.content_id || '') +
          '|' +
          (pageContext.page_locale || '');

        if (
          claritySignature &&
          claritySignature !== lastClarityPageSignature &&
          typeof window.clarity === 'function'
        ) {
          window.clarity('event', 'docs_article_view');
          lastClarityPageSignature = claritySignature;
        }
      })
      .catch(function () {
        // Keep docs functional even if Clarity fails to load.
      });
  }

  function trackEvent(eventName, payload) {
    if (
      !isAnalyticsConsentGranted() ||
      !GA_MEASUREMENT_ID ||
      typeof window.gtag !== 'function' ||
      !isAnalyticsHostEnabled()
    ) {
      return;
    }

    window.gtag('event', eventName, payload);
  }

  function trackCurrentPage() {
    var payload = buildPageContext();

    if (isAnalyticsConsentGranted()) {
      bootstrapGa();

      if (typeof window.gtag === 'function' && isAnalyticsHostEnabled()) {
        var signature =
          payload.page_location +
          '|' +
          (payload.page_title || '') +
          '|' +
          (payload.page_referrer || '');

        if (signature !== lastTrackedSignature) {
          lastTrackedSignature = signature;
          lastTrackedLocation = payload.page_location;
          window.gtag('event', 'page_view', payload);
        }
      }
    }

    applyClarityState(payload);
  }

  function scheduleRouteRefresh() {
    if (pendingRouteTimer) {
      window.clearTimeout(pendingRouteTimer);
    }

    pendingRouteTimer = window.setTimeout(function () {
      pendingRouteTimer = null;
      ensureUi();
      syncUi();
      trackCurrentPage();
    }, 160);
  }

  function resolveUrl(href) {
    try {
      return new URL(href, window.location.href);
    } catch (_error) {
      return null;
    }
  }

  function getCtaId(anchor, destination) {
    var explicit = anchor.getAttribute('data-cta-id');
    if (explicit) {
      return explicit;
    }

    var hrefValue = destination.searchParams.get('cta_id');
    if (hrefValue) {
      return hrefValue;
    }

    var text = (anchor.textContent || '').trim();
    return text ? 'docs_link_' + toIdentifier(text).slice(0, 60) : undefined;
  }

  function handleDocumentClick(event) {
    if (!event.target || typeof event.target.closest !== 'function') {
      return;
    }

    var anchor = event.target.closest('a[href]');
    if (!anchor) {
      return;
    }

    var destination = resolveUrl(anchor.getAttribute('href'));
    if (!destination || !APP_HOSTS[destination.hostname]) {
      return;
    }

    var currentPage = buildPageContext();
    var ctaId = getCtaId(anchor, destination);
    trackEvent(
      'docs_cta_clicked',
      cleanObject({
        entry_surface: currentPage.entry_surface,
        entry_source: currentPage.entry_source,
        content_id: currentPage.content_id,
        content_type: currentPage.content_type,
        content_group: currentPage.content_group,
        article_slug: currentPage.article_slug,
        page_locale: currentPage.page_locale,
        page_path: currentPage.page_path,
        page_location: currentPage.page_location,
        canonical_url: currentPage.canonical_url,
        cta_id: ctaId,
        cta_label: (anchor.textContent || '').trim().slice(0, 120) || undefined,
        destination_host: destination.hostname,
        destination_path: destination.pathname,
        destination_content_id:
          destination.searchParams.get('content_id') || undefined,
        transport_type: 'beacon',
      }),
    );

    if (
      isSessionReplayConsentGranted() &&
      isSessionReplayEligiblePage(currentPage) &&
      typeof window.clarity === 'function'
    ) {
      if (ctaId) {
        window.clarity('set', 'cta_id', ctaId);
      }

      window.clarity('event', 'docs_cta_clicked');
    }
  }

  function closePreferences() {
    preferencesOpen = false;
    syncUi();
  }

  function openPreferences() {
    preferencesOpen = true;
    syncUi();
  }

  function ensureUi() {
    if (ui.root && document.body.contains(ui.root)) {
      return;
    }

    var root = document.createElement('div');
    root.id = 'traseq-docs-consent-root';
    root.innerHTML =
      '<div id="traseq-docs-consent-banner" class="traseq-docs-consent-card" role="dialog" aria-live="polite" aria-label="Cookie consent">' +
      '<div class="traseq-docs-consent-copy">' +
      '<p class="traseq-docs-consent-eyebrow">Privacy</p>' +
      '<p class="traseq-docs-consent-title">Cookie and Analytics Preferences</p>' +
      '<p class="traseq-docs-consent-body">Traseq docs can use optional Google Analytics 4 and, when configured, Microsoft Clarity on selected article pages to measure pageviews, CTA performance, and UX friction. They stay off until you allow them.</p>' +
      '</div>' +
      '<div class="traseq-docs-consent-actions">' +
      '<button type="button" data-consent-action="allow" class="traseq-docs-consent-button traseq-docs-consent-button-primary">Allow optional tracking</button>' +
      '<button type="button" data-consent-action="deny" class="traseq-docs-consent-button">Decline</button>' +
      '<button type="button" data-consent-action="preferences" class="traseq-docs-consent-button traseq-docs-consent-button-ghost">Preferences</button>' +
      '</div>' +
      '</div>' +
      '<button id="traseq-docs-consent-manage" type="button" class="traseq-docs-consent-manage">Cookie Preferences</button>' +
      '<div id="traseq-docs-consent-modal" class="traseq-docs-consent-modal" role="dialog" aria-modal="true" aria-label="Cookie preferences">' +
      '<div class="traseq-docs-consent-modal-card">' +
      '<div class="traseq-docs-consent-modal-copy">' +
      '<p class="traseq-docs-consent-eyebrow">Preferences</p>' +
      '<p class="traseq-docs-consent-title">Choose optional tracking</p>' +
      '<p class="traseq-docs-consent-body">Essential site functionality stays on. Google Analytics 4 measures docs usage and CTA flow; Microsoft Clarity session replay, when configured, is limited to selected article pages so you can review CTA friction and reading behavior.</p>' +
      '</div>' +
      '<div class="traseq-docs-consent-options">' +
      '<label class="traseq-docs-consent-option">' +
      '<span class="traseq-docs-consent-option-copy">' +
      '<span class="traseq-docs-consent-option-title">Strictly necessary</span>' +
      '<span class="traseq-docs-consent-option-body">Required for page delivery, navigation, and preserving your consent choice.</span>' +
      '</span>' +
      '<input type="checkbox" checked disabled aria-label="Strictly necessary cookies are always active" />' +
      '</label>' +
      '<label class="traseq-docs-consent-option">' +
      '<span class="traseq-docs-consent-option-copy">' +
      '<span class="traseq-docs-consent-option-title">Optional analytics</span>' +
      '<span class="traseq-docs-consent-option-body">Google Analytics 4 pageview and CTA measurement for docs.traseq.com.</span>' +
      '</span>' +
      '<input id="traseq-docs-consent-analytics-toggle" type="checkbox" aria-label="Allow optional analytics" />' +
      '</label>' +
      '<label class="traseq-docs-consent-option">' +
      '<span class="traseq-docs-consent-option-copy">' +
      '<span class="traseq-docs-consent-option-title">Article session replay</span>' +
      '<span class="traseq-docs-consent-option-body">Microsoft Clarity replay, when configured, on selected guides and learn-center pages to investigate CTA and scroll friction.</span>' +
      '</span>' +
      '<input id="traseq-docs-consent-session-replay-toggle" type="checkbox" aria-label="Allow article session replay" />' +
      '</label>' +
      '</div>' +
      '<div class="traseq-docs-consent-actions">' +
      '<button type="button" data-consent-action="save" class="traseq-docs-consent-button traseq-docs-consent-button-primary">Save preferences</button>' +
      '<button type="button" data-consent-action="reject" class="traseq-docs-consent-button">Reject optional tracking</button>' +
      '<button type="button" data-consent-action="cancel" class="traseq-docs-consent-button traseq-docs-consent-button-ghost">Cancel</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(root);

    ui.root = root;
    ui.banner = document.getElementById('traseq-docs-consent-banner');
    ui.manageButton = document.getElementById('traseq-docs-consent-manage');
    ui.modal = document.getElementById('traseq-docs-consent-modal');
    ui.analyticsToggle = document.getElementById(
      'traseq-docs-consent-analytics-toggle',
    );
    ui.sessionReplayToggle = document.getElementById(
      'traseq-docs-consent-session-replay-toggle',
    );

    root.addEventListener('click', function (event) {
      var target = event.target;

      if (!target || !target.getAttribute) {
        return;
      }

      var action = target.getAttribute('data-consent-action');

      if (action === 'allow') {
        setConsentCategories({
          analytics: true,
          sessionReplay: isSessionReplayAvailable(),
        });
        closePreferences();
        scheduleRouteRefresh();
        return;
      }

      if (action === 'deny' || action === 'reject') {
        denyConsent();
        closePreferences();
        return;
      }

      if (action === 'preferences') {
        openPreferences();
        return;
      }

      if (action === 'cancel') {
        closePreferences();
        return;
      }

      if (action === 'save') {
        setConsentCategories({
          analytics: !!ui.analyticsToggle.checked,
          sessionReplay:
            isSessionReplayAvailable() && !!ui.sessionReplayToggle.checked,
        });
        closePreferences();
        scheduleRouteRefresh();
      }
    });

    ui.manageButton.addEventListener('click', function () {
      openPreferences();
    });

    ui.modal.addEventListener('click', function (event) {
      if (event.target === ui.modal) {
        closePreferences();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && preferencesOpen) {
        closePreferences();
      }
    });
  }

  function syncUi() {
    if (!ui.root) {
      return;
    }

    ui.root.setAttribute('data-consent-state', consentState.consent);
    ui.banner.hidden = consentState.consent !== CONSENT_STATES.UNDECIDED;
    ui.manageButton.hidden = consentState.consent === CONSENT_STATES.UNDECIDED;
    ui.modal.hidden = !preferencesOpen;
    ui.analyticsToggle.checked = !!consentState.categories.analytics;
    ui.sessionReplayToggle.checked = !!consentState.categories.sessionReplay;
    ui.sessionReplayToggle.disabled = !isSessionReplayAvailable();
  }

  function applyConsentState() {
    if (isAnalyticsConsentGranted()) {
      bootstrapGa();
    } else {
      disableGa();
    }

    applyClarityState(buildPageContext());

    ensureUi();
    syncUi();
  }

  function installNavigationTracking() {
    var originalPushState = window.history.pushState;
    var originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState() {
      var result = originalPushState.apply(this, arguments);
      scheduleRouteRefresh();
      return result;
    };

    window.history.replaceState = function replaceState() {
      var result = originalReplaceState.apply(this, arguments);
      scheduleRouteRefresh();
      return result;
    };

    window.addEventListener('popstate', scheduleRouteRefresh);
    window.addEventListener('hashchange', scheduleRouteRefresh);

    lastObservedPath = getPathSignature();
    window.setInterval(function () {
      var nextPath = getPathSignature();

      if (nextPath === lastObservedPath) {
        return;
      }

      lastObservedPath = nextPath;
      scheduleRouteRefresh();
    }, 1000);
  }

  function bootstrap() {
    consentState = loadConsentState();
    ensureUi();
    applyConsentState();
    installNavigationTracking();
    document.addEventListener('click', handleDocumentClick, true);

    if (isAnyOptionalTrackingGranted()) {
      scheduleRouteRefresh();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
