import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiRequest,
  getTokenRole,
  getWebSocketUrl,
  getStoredToken,
  saveSession,
  clearSession,
  uploadFile,
} from "./api";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";
import "./App.css";
import LocationAutocomplete from "./LocationAutocomplete";
import LocationMap from "./LocationMap";
import SortableList from "./SortableList";
import { reverseGeocodeLocation } from "./geocoding";
import {
  formatStoredDimensions,
  formatStoredWeight,
  getMeasurementSystem,
} from "./measurement";

const GOOGLE_CLIENT_ID =
  process.env.REACT_APP_GOOGLE_CLIENT_ID ||
  "456614025207-m4ljumnedhiku3qo8t2fgci9r02ukoci.apps.googleusercontent.com";
let verificationTokenInProgress = "";

function getDefaultPhoneCountry() {
  try {
    const region = new Intl.Locale(navigator.language || "en-US").region;
    return region && /^[A-Z]{2}$/i.test(region) ? region.toLowerCase() : "us";
  } catch {
    return "us";
  }
}

function toInternationalPhone(value, dialCode) {
  const digits = value.replace(/\D/g, "");
  if (!digits || (dialCode && digits === dialCode)) return null;
  return `+${digits}`;
}

function getPhoneInputValue(value) {
  return value ? value.replace(/\D/g, "") : "";
}

function Icon({ name, size = 20 }) {
  const paths = {
    arrow: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9" /></>,
    message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h2a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z" /></>,
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function getErrorMessage(error) {
  return error?.message || "Something went wrong. Please try again.";
}

function formatDate(value, options = { month: "short", day: "numeric" }) {
  if (!value) return "Date flexible";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date flexible"
    : new Intl.DateTimeFormat(undefined, options).format(date);
}

function announcementTitle(announcement) {
  return announcement.translations?.[0]?.title || "A delivery along the way";
}

function announcementDescription(announcement) {
  return announcement.translations?.[0]?.description || "";
}

function hasCoordinates(latitude, longitude) {
  const isCoordinate = (value) => value !== null && value !== undefined && value !== ""
    && Number.isFinite(Number(value));
  return isCoordinate(latitude) && isCoordinate(longitude);
}

function dateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function coordinateLocation(label, latitude, longitude) {
  return hasCoordinates(latitude, longitude)
    ? { id: `saved/${latitude},${longitude}`, label, latitude: Number(latitude), longitude: Number(longitude) }
    : null;
}

function roundedMeasurement(value, factor) {
  const converted = Number(value) * factor;
  return String(Math.round(converted * 10) / 10);
}

function announcementEditForm(announcement) {
  const measurementSystem = getMeasurementSystem();
  const weightFactor = measurementSystem === "imperial" ? 2.2046226218 : 1;
  const dimensionFactor = measurementSystem === "imperial" ? 1 / 2.54 : 1;
  return {
    title: announcementTitle(announcement),
    description: announcementDescription(announcement),
    postingPlace: announcement.postingPlace || "",
    receptionPlace: announcement.receptionPlace || "",
    postingDateTime: dateTimeLocalValue(announcement.postingDateTime),
    receptionDateTime: dateTimeLocalValue(announcement.receptionDateTime),
    origin: coordinateLocation(announcement.postingPlace, announcement.postingLatitude, announcement.postingLongitude),
    destination: coordinateLocation(announcement.receptionPlace, announcement.receptionLatitude, announcement.receptionLongitude),
    weight: announcement.weight?.value ? roundedMeasurement(announcement.weight.value, weightFactor) : "",
    dimensions: {
      width: announcement.dimensions?.width ? roundedMeasurement(announcement.dimensions.width, dimensionFactor) : "",
      height: announcement.dimensions?.height ? roundedMeasurement(announcement.dimensions.height, dimensionFactor) : "",
      length: announcement.dimensions?.length ? roundedMeasurement(announcement.dimensions.length, dimensionFactor) : "",
    },
    includeWeight: Boolean(announcement.weight?.value),
    includeDimensions: Boolean(announcement.dimensions?.width || announcement.dimensions?.height || announcement.dimensions?.length),
    stops: sortStopsByPosition(announcement.stops || []).map(({ stop }, index) => ({
      key: `saved-stop-${stop.id || index}`,
      serverId: stop.id,
      address: stop.address || "",
      location: coordinateLocation(stop.address, stop.latitude, stop.longitude),
    })),
  };
}

function isAllowedAttachmentType(type) {
  return new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "application/zip",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
  ]).has(type.toLowerCase());
}

function App() {
  const [token, setToken] = useState(getStoredToken);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(() => getTokenRole(getStoredToken()));
  const [announcements, setAnnouncements] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [listingPage, setListingPage] = useState(0);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const [announcementError, setAnnouncementError] = useState("");
  const [search, setSearch] = useState("");
  const [originSearch, setOriginSearch] = useState("");
  const [destinationSearch, setDestinationSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState("explore");
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [resetToken, setResetToken] = useState("");
  const [notice, setNotice] = useState("");
  const [conversations, setConversations] = useState([]);
  const [supportConversations, setSupportConversations] = useState([]);
  const [inboxMode, setInboxMode] = useState("messages");
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeConversationIsSupport, setActiveConversationIsSupport] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [supportDraft, setSupportDraft] = useState("");
  const [supportError, setSupportError] = useState("");
  const [sendingSupport, setSendingSupport] = useState(false);
  const [supportComposerOpen, setSupportComposerOpen] = useState(false);
  const [recentlyHiddenConversation, setRecentlyHiddenConversation] = useState(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const resetValue = url.searchParams.get("token");
    if (url.pathname.endsWith("/auth/reset") && resetValue) {
      setResetToken(resetValue);
      setAuthMode("reset-confirm");
      setAuthOpen(true);
      return;
    }
    if (url.pathname.endsWith("/auth/verify") && resetValue) {
      if (verificationTokenInProgress === resetValue) return;
      verificationTokenInProgress = resetValue;
      apiRequest(`/auth/verify?token=${encodeURIComponent(resetValue)}`)
        .then((response) => setNotice(response?.message || "Your email has been verified. You can now sign in."))
        .catch((error) => setNotice(getErrorMessage(error)))
        .finally(() => {
          verificationTokenInProgress = "";
          window.history.replaceState({}, "", "/");
        });
    }
  }, []);

  useEffect(() => {
    const handleExpired = () => {
      setToken("");
      setRole("");
      setUser(null);
      setNotice("Your session expired. Please sign in again.");
    };
    const handleRefreshed = (event) => {
      setToken(event.detail.token);
      setRole(getTokenRole(event.detail.token));
    };
    window.addEventListener("wayline:session-expired", handleExpired);
    window.addEventListener("wayline:token-refreshed", handleRefreshed);
    return () => {
      window.removeEventListener("wayline:session-expired", handleExpired);
      window.removeEventListener("wayline:token-refreshed", handleRefreshed);
    };
  }, []);

  const loadAnnouncements = useCallback(async () => {
    setLoadingAnnouncements(true);
    setAnnouncementError("");
    try {
      const filters = {
        text: search.trim() || undefined,
        postingPlace: originSearch.trim() || undefined,
        receptionPlace: destinationSearch.trim() || undefined,
        type: typeFilter === "all" ? undefined : typeFilter,
      };
      const hasFilter = Object.values(filters).some(Boolean);
      const query = new URLSearchParams({ page: String(listingPage), size: "12" });
      const response = await apiRequest(
        hasFilter
          ? `/announcements/search?${query}`
          : `/announcements?${query}`,
        hasFilter ? { method: "POST", body: filters } : {},
      );
      setAnnouncements(response.items || []);
      setTotalItems(response.totalItems || 0);
      setTotalPages(response.totalPages || 0);
    } catch (error) {
      setAnnouncementError(getErrorMessage(error));
    } finally {
      setLoadingAnnouncements(false);
    }
  }, [search, originSearch, destinationSearch, typeFilter, listingPage]);

  useEffect(() => {
    const timer = window.setTimeout(loadAnnouncements, 250);
    return () => window.clearTimeout(timer);
  }, [loadAnnouncements]);

  useEffect(() => {
    setListingPage(0);
  }, [search, originSearch, destinationSearch, typeFilter]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    let active = true;
    apiRequest("/users/me", { token })
      .then((profile) => {
        if (active) setUser(profile);
      })
      .catch(() => {
        if (active) {
          clearSession();
          setToken("");
          setUser(null);
          setRole("");
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const result = await apiRequest("/conversations/list", { token });
      setConversations(Array.isArray(result) ? result : []);
    } catch (error) {
      setNotice(getErrorMessage(error));
    }
  }, [token]);

  const loadSupportConversations = useCallback(async () => {
    if (!token) return;
    try {
      const result = await apiRequest("/conversations/support", { token });
      setSupportConversations(Array.isArray(result) ? result : []);
    } catch (error) {
      setNotice(getErrorMessage(error));
    }
  }, [token]);

  useEffect(() => {
    if (page !== "messages") return;
    if (inboxMode === "support") loadSupportConversations();
    else loadConversations();
  }, [page, inboxMode, loadConversations, loadSupportConversations]);

  const loadMessages = useCallback(
    async (conversation, before = null) => {
      if (!conversation || !token) return;
      setMessagesError("");
      if (before) setLoadingOlderMessages(true);
      try {
        const beforeQuery = before ? `&before=${encodeURIComponent(before)}` : "";
        const result = await apiRequest(
          `/conversations/${conversation.id}/messages?limit=50${beforeQuery}`,
          { token },
        );
        const ordered = [...(result.messages || [])].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
        setMessages((current) => before ? [...ordered, ...current] : ordered);
        setMessagesHasMore(Boolean(result.hasMore));
      } catch (error) {
        setMessagesError(getErrorMessage(error));
      } finally {
        setLoadingOlderMessages(false);
      }
    },
    [token],
  );

  const loadOlderMessages = useCallback(() => {
    if (!activeConversation || !messages.length || loadingOlderMessages) return;
    const oldest = messages.reduce((current, item) => new Date(item.createdAt) < new Date(current.createdAt) ? item : current, messages[0]);
    const before = new Date(oldest.createdAt).getTime();
    return loadMessages(activeConversation, before);
  }, [activeConversation, loadMessages, loadingOlderMessages, messages]);

  const refreshActiveMessages = useCallback(
    () => loadMessages(activeConversation),
    [activeConversation, loadMessages],
  );
  const setSearchMessages = useCallback((items) => {
    setMessages([...items].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt)));
    setMessagesHasMore(false);
  }, []);
  const updateUnreadCount = useCallback((conversationId, unreadCount) => {
    const updateUnread = (current) => current.map((item) =>
      String(item.id) === String(conversationId) ? { ...item, unreadCount } : item,
    );
    setConversations(updateUnread);
    setSupportConversations(updateUnread);
  }, []);

  useEffect(() => {
    loadMessages(activeConversation);
  }, [activeConversation, loadMessages]);

  const handleAuth = (authResponse) => {
    saveSession(authResponse.token, authResponse.user);
    setToken(authResponse.token);
    setUser(authResponse.user);
    setRole(getTokenRole(authResponse.token));
    setAuthOpen(false);
    setNotice(`Welcome${authResponse.user?.name ? `, ${authResponse.user.name.split(" ")[0]}` : ""}!`);
  };

  const handleLogout = async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST", token });
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      clearSession();
      setToken("");
      setUser(null);
      setRole("");
      setConversations([]);
      setSupportConversations([]);
      setMessages([]);
      setPage("explore");
    }
  };

  const handleDeleteAccount = async () => {
    await apiRequest("/users/me", { method: "DELETE", token });
    let logoutError = "";
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch (error) {
      logoutError = getErrorMessage(error);
    } finally {
      clearSession();
      setToken("");
      setRole("");
      setUser(null);
      setConversations([]);
      setSupportConversations([]);
      setMessages([]);
      setPage("explore");
      setSelectedAnnouncement(null);
      setAnnouncements([]);
      setTotalItems(0);
      setTotalPages(0);
      setNotice(logoutError
        ? `Your account was deleted, but the sign-out cookie could not be cleared: ${logoutError}`
        : "Your Wayline account has been deleted.");
      await loadAnnouncements();
    }
  };

  const handleConversationVisibility = async (conversation) => {
    try {
      if (conversation.deletedAt) {
        await apiRequest(`/conversations/${conversation.id}/restore`, { method: "POST", token });
        setRecentlyHiddenConversation(null);
        setNotice("Conversation restored.");
      } else {
        await apiRequest(`/conversations/${conversation.id}`, { method: "DELETE", token });
        setConversations((current) => current.filter((item) => item.id !== conversation.id));
        setRecentlyHiddenConversation(conversation);
        setActiveConversation(null);
      }
      await loadConversations();
    } catch (error) {
      setNotice(getErrorMessage(error));
    }
  };

  const startSupportConversation = async (content) => {
    const result = await apiRequest("/messages/support/send", {
      method: "POST",
      token,
      body: { content },
    });
    await loadSupportConversations();
    const conversation = {
      id: result.conversationId,
      participants: [{ id: user?.id, name: user?.name }, { id: 1, name: "Wayline Support" }],
    };
    setActiveConversation(conversation);
    setActiveConversationIsSupport(true);
    setInboxMode("support");
    setPage("messages");
  };

  const startConversation = async (announcement) => {
    if (!token) {
      setSelectedAnnouncement(null);
      setAuthOpen(true);
      setNotice("Sign in to message the person who posted this route.");
      return;
    }
    try {
      const conversation = await apiRequest("/conversations", {
        method: "POST",
        token,
        body: {
          participantIds: [announcement.userId],
          announcementId: announcement.id,
        },
      });
      setActiveConversation(conversation);
      setPage("messages");
      await loadConversations();
    } catch (error) {
      setNotice(getErrorMessage(error));
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#explore"
          onClick={(event) => {
            event.preventDefault();
            setPage("explore");
          }}
          aria-label="Wayline home"
        >
          <span className="brand-mark"><Icon name="route" size={21} /></span>
          <span>wayline<span className="brand-period">.</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={page === "explore" ? "nav-link active" : "nav-link"} onClick={() => setPage("explore")}>Find deliveries</button>
          <button className={page === "messages" ? "nav-link active" : "nav-link"} onClick={() => token ? setPage("messages") : setAuthOpen(true)}>Messages{conversations.some((item) => item.unreadCount > 0) && <span className="unread-dot" />}</button>
        </nav>
        <div className="topbar-actions">
          {user ? (
            <>
              <button className="post-button" onClick={() => setPage("post")}><Icon name="plus" size={17} /> Post an ad</button>
              <button className="profile-button" onClick={() => setPage("profile")} title="Profile settings">
                <span className="avatar">{user.photoUrl ? <img src={user.photoUrl} alt="" /> : (user.name || user.email || "Y").slice(0, 1).toUpperCase()}</span>
                <span className="profile-name">{user.name || "Account"}</span>
                <Icon name="user" size={17} />
              </button>
            </>
          ) : (
            <>
              <button className="text-button" onClick={() => { setAuthMode("login"); setAuthOpen(true); }}>Log in</button>
              <button className="post-button" onClick={() => { setAuthMode("register"); setAuthOpen(true); }}>Join free <Icon name="arrow" size={16} /></button>
            </>
          )}
        </div>
      </header>

      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><Icon name="close" size={16} /></button></div>}

      {page === "explore" && (
        <main>
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-line" /> A better way to get there</div>
              <h1>Send it with<br />someone <span>going your way.</span></h1>
              <p>Need a parcel delivered, or already traveling and willing to carry one? Connect here for parcel delivery—not ride-sharing.</p>
              <div className="hero-proof"><span className="proof-check"><Icon name="check" size={13} /></span><span>Connect senders with travelers already on the way.</span></div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-sun" />
              <div className="art-route"><span /><span /><span /></div>
              <div className="art-card art-card-one"><span className="art-icon"><Icon name="box" size={17} /></span><span><b>Same direction</b><small>A parcel along the way</small></span><Icon name="check" size={16} /></div>
              <div className="art-card art-card-two"><span className="art-avatar">M</span><span><b>Meet the community</b><small>Good things travel</small></span></div>
              <div className="art-label">A little closer, together <span>✦</span></div>
            </div>
          </section>

          <section className="search-panel" aria-label="Find a route">
            <label className="search-field">
              <Icon name="search" size={19} />
              <span className="search-label">I’m looking for</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="A route title or description..." />
            </label>
            <label className="filter-field location-field">
              <Icon name="pin" size={18} />
              <span className="field-name">From</span>
              <input value={originSearch} onChange={(event) => setOriginSearch(event.target.value)} placeholder="Starting city" />
            </label>
            <label className="filter-field location-field">
              <Icon name="pin" size={18} />
              <span className="field-name">To</span>
              <input value={destinationSearch} onChange={(event) => setDestinationSearch(event.target.value)} placeholder="Destination" />
            </label>
            <div className="filter-field">
              <Icon name="route" size={19} />
              <label htmlFor="route-type">Ad type</label>
              <select id="route-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">All ads</option>
                <option value="sender">Needs a courier</option>
                <option value="courier">Can deliver a parcel</option>
              </select>
            </div>
            <button className="search-button" onClick={loadAnnouncements}><Icon name="search" size={18} /><span>Find a delivery</span></button>
          </section>

          <section className="listings-section">
            <div className="section-heading">
              <div><div className="eyebrow section-eyebrow">THE COMMUNITY BOARD</div><h2>Parcels going places</h2><p>Find someone to deliver your parcel, or offer to carry one.</p></div>
              <div className="results-count">{totalItems ? `${totalItems} ${totalItems === 1 ? "ad" : "ads"}` : "New delivery ads, every day"} <span className="count-dot" /></div>
            </div>

            {announcementError && <div className="inline-error" role="alert">{announcementError}<button onClick={loadAnnouncements}>Try again</button></div>}
            {loadingAnnouncements ? (
              <div className="listing-grid" aria-label="Loading delivery ads">{[1, 2, 3].map((item) => <div className="listing-skeleton" key={item} />)}</div>
            ) : announcements.length > 0 ? (
              <div className="listing-grid">
                {announcements.map((announcement, index) => (
                  <AnnouncementCard
                    key={announcement.id}
                    announcement={announcement}
                    index={index}
                    onOpen={() => setSelectedAnnouncement(announcement)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon"><Icon name="route" size={25} /></span>
                <h3>{announcementError ? "We couldn’t load delivery ads" : "The road is open"}</h3>
                <p>{announcementError ? "Check that the API is running, then try again." : "No delivery ads match just yet. Try another search, or be the first to post one."}</p>
                {!announcementError && <button className="outline-button" onClick={() => token ? setPage("post") : setAuthOpen(true)}>Post an ad <Icon name="arrow" size={16} /></button>}
              </div>
            )}
            {!loadingAnnouncements && totalPages > 1 && <div className="pagination" aria-label="Route pages">
              <button disabled={listingPage === 0} onClick={() => setListingPage((current) => Math.max(0, current - 1))}>Previous</button>
              <span>Page {listingPage + 1} of {totalPages}</span>
              <button disabled={listingPage + 1 >= totalPages} onClick={() => setListingPage((current) => Math.min(totalPages - 1, current + 1))}>Next <Icon name="arrow" size={15} /></button>
            </div>}
          </section>

          <section className="bottom-cta">
            <div className="cta-mark"><Icon name="spark" size={24} /></div>
            <div><h2>Already heading somewhere?</h2><p>Offer to carry a parcel on a trip you’re already making.</p></div>
            <button className="cta-button" onClick={() => token ? setPage("post") : setAuthOpen(true)}>Offer delivery <Icon name="arrow" size={17} /></button>
          </section>
        </main>
      )}

      {page === "post" && <PostRoute token={token} user={user} onRequireAuth={() => setAuthOpen(true)} onPosted={(created, failures = []) => { setPage("explore"); setSelectedAnnouncement(created); loadAnnouncements(); setNotice(failures.length ? `Your ad is live, but some photos failed: ${failures.map((failure) => `${failure.name}: ${failure.message}`).join("; ")}` : "Your ad is live. Let’s see where it goes."); }} />}

      {page === "profile" && <ProfilePage
        token={token}
        user={user}
        onSave={(updatedUser) => { setUser(updatedUser); setNotice("Your profile has been updated."); }}
        onSignOut={handleLogout}
        onDeleteAccount={handleDeleteAccount}
        onRequireAuth={() => setAuthOpen(true)}
      />}

      {page === "messages" && (
        <main className="messages-page">
          <div className="messages-title"><div className="eyebrow section-eyebrow">{inboxMode === "support" && role === "ADMIN" ? "TEAM WORKSPACE" : "YOUR INBOX"}</div><h1>{inboxMode === "support" && role === "ADMIN" ? "Support queue" : "Conversations"}</h1><p>{inboxMode === "support" && role === "ADMIN" ? "Help members find their way forward." : "Good plans start with a hello."}</p></div>
          <div className="inbox">
            <aside className="conversation-list">
              <div className="inbox-tabs">
                <button className={inboxMode === "messages" ? "selected" : ""} onClick={() => { setInboxMode("messages"); setActiveConversation(null); }}>Messages</button>
                <button className={inboxMode === "support" ? "selected" : ""} onClick={() => { setInboxMode("support"); setActiveConversation(null); }}>{role === "ADMIN" ? "Support queue" : "Support"}</button>
              </div>
              <div className="inbox-label">{inboxMode === "support" && role === "ADMIN" ? "OPEN REQUESTS" : inboxMode === "support" ? "SUPPORT THREADS" : "MESSAGES"} <span>{(inboxMode === "support" ? supportConversations : conversations).length}</span></div>
              {(inboxMode === "support" ? supportConversations : conversations).length ? (inboxMode === "support" ? supportConversations : conversations).map((conversation) => {
                const other = conversation.participants?.find((person) => String(person.id) !== String(user?.id)) || conversation.participants?.[0];
                return <div key={conversation.id} className={`conversation-row-wrap ${activeConversation?.id === conversation.id ? "selected" : ""}`}>
                  <button className="conversation-row" onClick={() => { setActiveConversation(conversation); setActiveConversationIsSupport(inboxMode === "support"); }}>
                  <span className="avatar conversation-avatar">{other?.photoUrl ? <img src={other.photoUrl} alt="" /> : (other?.name || (inboxMode === "support" && role === "ADMIN" ? "Member" : "Support")).slice(0, 1).toUpperCase()}</span>
                  <span className="conversation-meta"><b>{inboxMode === "support" && role !== "ADMIN" ? "Wayline Support" : other?.name || "Wayline member"}</b><small>{conversation.otherUserOnline ? "Online now" : inboxMode === "support" ? "Support conversation" : "Open conversation"}</small></span>
                  {conversation.unreadCount > 0 && <span className="unread-count">{conversation.unreadCount}</span>}
                  </button>
                  {inboxMode === "messages" && <button className="conversation-dismiss" title="Hide conversation" onClick={() => handleConversationVisibility(conversation)} aria-label={`Hide conversation with ${other?.name || "member"}`}>×</button>}
                </div>;
              }) : <div className="conversation-empty">Your conversations will appear here when you connect with someone on a route.</div>}
              {inboxMode === "messages" && recentlyHiddenConversation && <button className="restore-conversation" onClick={() => handleConversationVisibility({ ...recentlyHiddenConversation, deletedAt: true })}>Restore recently hidden conversation</button>}
              {inboxMode === "support" && role !== "ADMIN" && <button className="new-support-button" onClick={() => setSupportComposerOpen(true)}><Icon name="plus" size={15} />Contact support</button>}
            </aside>
            <section className="message-panel">
              {supportComposerOpen && inboxMode === "support" && role !== "ADMIN" ? <form className="support-request-form" onSubmit={async (event) => {
                event.preventDefault();
                if (!supportDraft.trim()) return;
                setSendingSupport(true);
                setSupportError("");
                try {
                  await startSupportConversation(supportDraft.trim());
                  setSupportDraft("");
                  setSupportComposerOpen(false);
                } catch (error) {
                  setSupportError(getErrorMessage(error));
                } finally {
                  setSendingSupport(false);
                }
              }}><div className="support-request-icon"><Icon name="message" size={21} /></div><h2>How can we help?</h2><p>Send a note to our support team. We’ll reply in this inbox.</p><textarea value={supportDraft} maxLength="2000" onChange={(event) => setSupportDraft(event.target.value)} placeholder="Tell us what’s on your mind..." required /><button className="dialog-primary" disabled={sendingSupport || !supportDraft.trim()}>{sendingSupport ? "Sending..." : "Send to support"}<Icon name="arrow" size={16} /></button>{supportError && <p className="form-error" role="alert">{supportError}</p>}</form> : activeConversation ? <ConversationPanel
                conversation={activeConversation}
                messages={messages}
                error={messagesError}
                token={token}
                user={user}
                role={role}
                isSupport={activeConversationIsSupport}
                onBlock={async (blockedId, isBlocked) => {
                  await apiRequest(isBlocked ? "/unblock" : "/block", {
                    method: isBlocked ? "DELETE" : "POST",
                    token,
                    body: { blockedId },
                  });
                  setNotice(isBlocked ? "This member has been unblocked." : "This member has been blocked.");
                  await loadConversations();
                }}
                onUnreadCount={updateUnreadCount}
                onDeleteMessage={async (messageId) => {
                  await apiRequest(`/messages/${messageId}`, { method: "DELETE", token });
                  await loadMessages(activeConversation);
                }}
                onReact={async (messageId, reaction) => {
                  await apiRequest("/messages/reactions", { method: "POST", token, body: { messageId, reaction } });
                  await loadMessages(activeConversation);
                }}
                onAttachment={async (messageId, files) => {
                  for (const file of files) {
                    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} exceeds the 5 MB limit.`);
                    if (!isAllowedAttachmentType(file.type)) throw new Error(`${file.name} has an unsupported file type.`);
                    const urls = await apiRequest("/attachments/presign", {
                      method: "POST",
                      token,
                      body: { contentType: file.type, fileSize: file.size, messageId },
                    });
                    await uploadFile(urls.uploadUrl, file);
                    await apiRequest("/messages/attachments", {
                      method: "POST",
                      token,
                      body: { messageId, url: urls.fileUrl, type: file.type, size: file.size },
                    });
                  }
                  await loadMessages(activeConversation);
                }}
                onSearchResults={setSearchMessages}
                onRefreshMessages={refreshActiveMessages}
                onSearchReset={refreshActiveMessages}
                hasMore={messagesHasMore}
                loadingOlder={loadingOlderMessages}
                onLoadOlder={loadOlderMessages}
                onSend={async (content) => {
                  let sent;
                  if (activeConversationIsSupport && role === "ADMIN") {
                    sent = await apiRequest("/messages/support/reply", { method: "POST", token, body: { conversationId: activeConversation.id, content } });
                  } else if (activeConversationIsSupport) {
                    sent = await apiRequest("/messages/support/send", { method: "POST", token, body: { content } });
                  } else {
                    sent = await apiRequest("/messages", { method: "POST", token, body: { conversationId: activeConversation.id, content } });
                  }
                  await loadMessages(activeConversation);
                  return sent;
                }}
              /> : <div className="message-placeholder"><span className="empty-icon"><Icon name="message" size={24} /></span><h2>{inboxMode === "support" && role === "ADMIN" ? "All caught up?" : "Pick up where you left off"}</h2><p>{inboxMode === "support" && role === "ADMIN" ? "Choose a support request to reply to." : inboxMode === "support" ? "Open a support thread or start a new one." : "Select a conversation to see your messages."}</p></div>}
            </section>
          </div>
        </main>
      )}

      <footer className="site-footer"><a className="footer-brand" href="#explore" onClick={(event) => { event.preventDefault(); setPage("explore"); }}>wayline<span>.</span></a><span>Make the miles mean more.</span><span>© {new Date().getFullYear()} Wayline</span></footer>

      {selectedAnnouncement && <AnnouncementDialog
        announcement={selectedAnnouncement}
        token={token}
        onClose={() => setSelectedAnnouncement(null)}
        onContact={() => startConversation(selectedAnnouncement)}
        onChange={(updated) => {
          setSelectedAnnouncement(updated);
          loadAnnouncements();
        }}
        onDelete={async () => {
          await apiRequest(`/announcements/${selectedAnnouncement.id}`, { method: "DELETE", token });
          setSelectedAnnouncement(null);
          await loadAnnouncements();
          setNotice("Your route has been removed.");
        }}
        user={user}
      />}
      {authOpen && <AuthDialog initialMode={authMode} resetToken={resetToken} onClose={() => setAuthOpen(false)} onAuthenticated={handleAuth} onNotice={setNotice} />}
    </div>
  );
}

function AnnouncementCard({ announcement, index, onOpen }) {
  const needsCourier = announcement.type === "sender";
  const routeClass = needsCourier ? "sender" : "courier";
  const title = announcementTitle(announcement);
  return (
    <article className={`route-card card-${index % 3}`}>
      <button className="card-open" onClick={onOpen} aria-label={`View ${title}`} />
      <div className={`route-card-art ${routeClass}`}>
        <span className="route-category"><span />{needsCourier ? "Parcel needs a courier" : "Can deliver a parcel"}</span>
        <span className="route-art-symbol"><Icon name={needsCourier ? "box" : "route"} size={28} /></span>
        <div className="route-city route-city-start">{announcement.postingPlace || "Starting point"}<span /></div>
        <div className="route-dotted" />
        <div className="route-city route-city-end">{announcement.receptionPlace || "Destination"}<span /></div>
      </div>
      <div className="route-card-content">
        <div className="route-card-meta"><span><Icon name="calendar" size={15} />{formatDate(announcement.postingDateTime)}</span><span><Icon name="pin" size={15} />{announcement.stops?.length || 0} stops</span></div>
        <h3>{title}</h3>
        <p>{announcementDescription(announcement) || `${needsCourier ? "Looking for a traveler to deliver this parcel." : "Offering to carry a parcel along this route."}`}</p>
        <div className="route-card-bottom"><span className="avatar avatar-small">W</span><span className="poster-caption">Wayline member</span><button className="card-arrow" onClick={onOpen} aria-label="See route details"><Icon name="arrow" size={17} /></button></div>
      </div>
    </article>
  );
}

function ProfilePage({ token, user, onSave, onSignOut, onDeleteAccount, onRequireAuth }) {
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [ageRange, setAgeRange] = useState(user?.ageRange || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [phone, setPhone] = useState(() => getPhoneInputValue(user?.phone));
  const [phoneCountry] = useState(getDefaultPhoneCountry);
  const [phoneDialCode, setPhoneDialCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setEmail(user?.email || "");
    setAgeRange(user?.ageRange || "");
    setGender(user?.gender || "");
    setPhone(getPhoneInputValue(user?.phone));
  }, [user]);

  const handlePhoneChange = (value, country) => {
    setPhone(value);
    if (country?.dialCode) setPhoneDialCode(country.dialCode);
  };

  const handlePhoneMount = (value, country) => {
    if (country?.dialCode) setPhoneDialCode(country.dialCode);
  };

  if (!token || !user) return <main className="post-page"><div className="post-auth"><span className="empty-icon"><Icon name="user" size={25} /></span><h1>Your Wayline starts here.</h1><p>Sign in to see and update your account details.</p><button className="dialog-primary" onClick={onRequireAuth}>Continue to sign in <Icon name="arrow" size={17} /></button></div></main>;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest("/users/me", {
        method: "PUT",
        token,
        body: {
          name,
          email,
          ageRange: ageRange || null,
          gender: gender || null,
          phone: toInternationalPhone(phone, phoneDialCode),
          locale: navigator.language?.toLowerCase().startsWith("pl") ? "pl" : "en",
          ...(password ? { password } : {}),
        },
      });
      setPassword("");
      onSave(updated);
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    setAvatarBusy(true);
    setError("");
    try {
      if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
        throw new Error("Choose a JPG or PNG image.");
      }
      if (!file.size || file.size > 5 * 1024 * 1024) {
        throw new Error("Profile photos must be smaller than 5 MB.");
      }
      const signed = await apiRequest("/users/me/avatar/presign", {
        method: "POST",
        token,
        body: { contentType: file.type, fileSize: file.size },
      });
      await uploadFile(signed.uploadUrl, file);
      await apiRequest("/users/me/avatar", {
        method: "POST",
        token,
        body: { fileUrl: signed.fileUrl, contentType: file.type, fileSize: file.size },
      });
      onSave(await apiRequest("/users/me", { token }));
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    setError("");
    try {
      await apiRequest("/users/me/avatar", { method: "DELETE", token });
      onSave(await apiRequest("/users/me", { token }));
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setAvatarBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm("Permanently delete your account, routes, and account data? This cannot be undone.")) return;
    setDeleteBusy(true);
    setError("");
    try {
      await onDeleteAccount();
    } catch (failure) {
      setError(getErrorMessage(failure));
      setDeleteBusy(false);
    }
  };

  return <main className="profile-page">
    <div className="post-intro"><div className="eyebrow section-eyebrow">YOUR ACCOUNT</div><h1>Profile settings</h1><p>Keep your details up to date so your next connection starts smoothly.</p></div>
    <div className="profile-card">
      <div className="profile-identity"><span className="profile-large-avatar">{user.photoUrl ? <img src={user.photoUrl} alt="Your profile" /> : (user.name || user.email || "Y").slice(0, 1).toUpperCase()}</span><div><h2>{user.name || "Wayline member"}</h2><p>{user.email}</p><div className="avatar-actions">{!user.photoUrl && <label className="avatar-upload">{avatarBusy ? "Working..." : "Add a photo"}<input type="file" accept="image/jpeg,image/png" disabled={avatarBusy} onChange={(event) => { uploadAvatar(event.target.files?.[0]); event.target.value = ""; }} /></label>}{user.photoUrl && <button type="button" className="avatar-remove" disabled={avatarBusy} onClick={removeAvatar}>{avatarBusy ? "Working..." : "Remove photo"}</button>}</div></div></div>
      <form className="profile-form" onSubmit={submit}>
        <label>Full name<input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
        <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <div className="profile-optional-field">
          <div className="profile-field-heading"><label htmlFor="profile-age-range">Age range <span className="optional-label">optional</span></label><button type="button" className="profile-field-reset" aria-label="Clear age range" disabled={busy} onClick={() => setAgeRange("")}>Clear</button></div>
          <select id="profile-age-range" value={ageRange} onChange={(event) => setAgeRange(event.target.value)}>
          <option value="">Not specified</option>
          <option value="UNDER_19">Under 19</option>
          <option value="RANGE_20_29">20-29</option>
          <option value="RANGE_30_39">30-39</option>
          <option value="RANGE_40_49">40-49</option>
          <option value="RANGE_50_59">50-59</option>
          <option value="RANGE_60_69">60-69</option>
          <option value="RANGE_70_79">70-79</option>
          <option value="RANGE_80_89">80-89</option>
          <option value="OVER_90">90 or older</option>
          </select>
        </div>
        <div className="profile-optional-field">
          <div className="profile-field-heading"><label htmlFor="profile-gender">Gender <span className="optional-label">optional</span></label><button type="button" className="profile-field-reset" aria-label="Clear gender" disabled={busy} onClick={() => setGender("")}>Clear</button></div>
          <select id="profile-gender" value={gender} onChange={(event) => setGender(event.target.value)}>
          <option value="">Prefer not to say</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
          </select>
        </div>
        <div className="profile-optional-field">
          <div className="profile-field-heading"><label htmlFor="profile-phone">Phone number <span className="optional-label">optional</span></label><button type="button" className="profile-field-reset" aria-label="Clear phone number" disabled={busy} onClick={() => setPhone("")}>Clear</button></div>
          <PhoneInput
            country={phoneCountry}
            value={phone}
            onChange={handlePhoneChange}
            onMount={handlePhoneMount}
            enableSearch
            countryCodeEditable={false}
            specialLabel=""
            inputProps={{ id: "profile-phone", name: "phone", autoComplete: "tel" }}
            containerClass="profile-phone-input"
            inputClass="profile-phone-control"
            buttonClass="profile-phone-country"
            dropdownClass="profile-phone-country-list"
          />
        </div>
        <label>New password <span className="optional-label">optional</span><input type="password" minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="Leave blank to keep your password" /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="profile-actions"><button className="dialog-primary" disabled={busy || deleteBusy}>{busy ? "Saving..." : "Save changes"}<Icon name="check" size={16} /></button><button type="button" className="signout-button" onClick={onSignOut}><Icon name="logout" size={16} />Sign out</button></div>
        <div className="delete-account"><div><b>Delete account</b><span>Permanently remove your account and route listings.</span></div><button type="button" disabled={deleteBusy} onClick={deleteAccount}>{deleteBusy ? "Deleting..." : "Delete account"}</button></div>
      </form>
    </div>
  </main>;
}

function AnnouncementDialog({ announcement, token, onClose, onContact, onChange, onDelete, user }) {
  const [photos, setPhotos] = useState(() => sortPhotosByPosition(announcement.photos));
  const [photoError, setPhotoError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(() => announcementEditForm(announcement));
  const [activeLocationKey, setActiveLocationKey] = useState("origin");
  const [mapError, setMapError] = useState("");
  const reverseGeocodeController = useRef(null);
  const nextStopId = useRef(1);
  const measurementSystem = getMeasurementSystem();
  const needsCourier = announcement.type === "sender";
  useEffect(() => setPhotos(sortPhotosByPosition(announcement.photos)), [announcement]);
  useEffect(() => () => reverseGeocodeController.current?.abort(), []);

  const updateEditForm = (key, value) => setEditForm((current) => ({ ...current, [key]: value }));
  const updateEditLocation = (field, key, value, location) => {
    setEditForm((current) => ({ ...current, [field]: value, [key]: location }));
    setActiveLocationKey(key);
    setMapError("");
  };
  const handleEditMapPick = async ({ latitude, longitude }) => {
    const key = activeLocationKey;
    reverseGeocodeController.current?.abort();
    const controller = new AbortController();
    reverseGeocodeController.current = controller;
    const fallbackLocation = {
      id: `pin/${latitude},${longitude}`,
      label: `Pinned location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
      latitude,
      longitude,
    };
    const updateMapLocation = (location) => {
      if (key === "origin") updateEditLocation("postingPlace", key, location.label, location);
      else if (key === "destination") updateEditLocation("receptionPlace", key, location.label, location);
      else {
        setEditForm((current) => ({
          ...current,
          stops: current.stops.map((stop) => stop.key === key
            ? { ...stop, address: location.label, location }
            : stop),
        }));
        setMapError("");
      }
    };
    updateMapLocation(fallbackLocation);
    try {
      const location = await reverseGeocodeLocation(latitude, longitude, { signal: controller.signal });
      if (!controller.signal.aborted) updateMapLocation(location ? { ...location, latitude, longitude } : fallbackLocation);
    } catch (failure) {
      if (failure.name !== "AbortError" && !controller.signal.aborted) {
        updateMapLocation(fallbackLocation);
        setMapError(`${failure.message || "Could not look up this place."} The map pin coordinates are still selected.`);
      }
    }
  };

  const refreshPhotos = (updated) => {
    const ordered = sortPhotosByPosition(updated);
    setPhotos(ordered);
    onChange({ ...announcement, photos: ordered });
  };
  const setMainPhoto = async (photo) => {
    setPhotoBusy(true);
    setPhotoError("");
    try {
      refreshPhotos(await apiRequest(`/announcements/${announcement.id}/photos/${photo.id}/main`, { method: "PUT", token }));
    } catch (error) {
      setPhotoError(getErrorMessage(error));
    } finally {
      setPhotoBusy(false);
    }
  };
  const movePhoto = async (index, direction) => {
    const reordered = [...photos];
    const destination = index + direction;
    if (destination < 0 || destination >= reordered.length) return;
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    const sortedPhotos = reordered.map((photo, position) => ({ ...photo, position }));
    setPhotoBusy(true);
    setPhotoError("");
    try {
      refreshPhotos(await apiRequest(`/announcements/${announcement.id}/photos/sort`, {
        method: "PUT",
        token,
        body: sortedPhotos,
      }));
    } catch (error) {
      setPhotoError(getErrorMessage(error));
    } finally {
      setPhotoBusy(false);
    }
  };
  const removePhoto = async (photo) => {
    setPhotoBusy(true);
    setPhotoError("");
    try {
      await apiRequest(`/announcements/${announcement.id}/photos/${photo.id}`, { method: "DELETE", token });
      refreshPhotos(photos.filter((item) => item.id !== photo.id));
    } catch (error) {
      setPhotoError(getErrorMessage(error));
    } finally {
      setPhotoBusy(false);
    }
  };
  const addPhoto = async (file) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) throw new Error("Choose a JPG or PNG image.");
      if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Photos must be smaller than 5 MB.");
      if (photos.length >= 3) throw new Error("A parcel can have up to 3 photos.");
      const signed = await apiRequest(`/announcements/${announcement.id}/photos/presign`, {
        method: "POST",
        token,
        body: { contentType: file.type, fileSize: file.size },
      });
      await uploadFile(signed.uploadUrl, file);
      const photo = await apiRequest(`/announcements/${announcement.id}/photos`, {
        method: "POST",
        token,
        body: { fileUrl: signed.fileUrl, contentType: file.type, fileSize: file.size },
      });
      refreshPhotos([...photos, photo]);
    } catch (error) {
      setPhotoError(getErrorMessage(error));
    } finally {
      setPhotoBusy(false);
    }
  };
  const deleteAnnouncement = async () => {
    if (!window.confirm("Remove this route and its photos? This cannot be undone.")) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      await onDelete();
    } catch (error) {
      setPhotoError(getErrorMessage(error));
    } finally {
      setPhotoBusy(false);
    }
  };
  const saveAnnouncement = async (event) => {
    event.preventDefault();
    if (!editForm.origin) {
      setPhotoError("Select a starting city from the suggestions.");
      return;
    }
    if (!editForm.destination) {
      setPhotoError("Select a destination city from the suggestions.");
      return;
    }
    if (editForm.stops.some((stop) => !stop.location)) {
      setPhotoError("Select a suggested place for each stop, or remove that stop.");
      return;
    }
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const translations = announcement.translations?.length
        ? announcement.translations.map((translation, index) => index === 0
          ? { ...translation, title: editForm.title.trim(), description: editForm.description.trim() }
          : translation)
        : [{ language: navigator.language?.toLowerCase().startsWith("pl") ? "pl" : "en", title: editForm.title.trim(), description: editForm.description.trim() }];
      const response = await apiRequest(`/announcements/${announcement.id}`, {
        method: "PUT",
        token,
        body: {
          ...announcement,
          postingPlace: editForm.postingPlace,
          postingLatitude: editForm.origin.latitude,
          postingLongitude: editForm.origin.longitude,
          receptionPlace: editForm.receptionPlace,
          receptionLatitude: editForm.destination.latitude,
          receptionLongitude: editForm.destination.longitude,
          postingDateTime: editForm.postingDateTime,
          receptionDateTime: editForm.receptionDateTime,
          translations,
          weight: editForm.includeWeight && editForm.weight
            ? { value: Number(editForm.weight), unit: measurementSystem }
            : null,
          dimensions: editForm.includeDimensions ? {
            width: Number(editForm.dimensions.width),
            height: Number(editForm.dimensions.height),
            length: Number(editForm.dimensions.length),
            unit: measurementSystem,
          } : null,
          stops: editForm.stops.map((stop, position) => ({
            ...(stop.serverId !== undefined ? { id: stop.serverId } : {}),
            address: stop.address,
            latitude: stop.location.latitude,
            longitude: stop.location.longitude,
            position,
          })),
        },
      });
      onChange(response.announcement);
      setEditing(false);
    } catch (error) {
      setPhotoError(getErrorMessage(error));
    } finally {
      setPhotoBusy(false);
    }
  };
  const editMapLocations = [
    { key: "origin", label: `Starting city: ${editForm.postingPlace}`, location: editForm.origin },
    ...editForm.stops.map((stop, index) => ({
      key: stop.key,
      label: `Stop ${index + 1}: ${stop.address}`,
      location: stop.location,
    })),
    { key: "destination", label: `Destination city: ${editForm.receptionPlace}`, location: editForm.destination },
  ];
  const activeLocationLabel = activeLocationKey === "origin"
    ? "Starting city"
    : activeLocationKey === "destination"
      ? "Destination city"
      : `Stop ${editForm.stops.findIndex((stop) => stop.key === activeLocationKey) + 1}`;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`detail-dialog${editing ? " route-editing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <button className="modal-close" onClick={onClose} aria-label="Close route details"><Icon name="close" size={20} /></button>
        <div className={`detail-banner ${needsCourier ? "sender" : "courier"}`}><span className="route-category"><span />{needsCourier ? "Parcel needs a courier" : "Can deliver a parcel"}</span><Icon name={needsCourier ? "box" : "route"} size={40} /></div>
        <div className="detail-body">
          <div className="detail-eyebrow">{formatDate(announcement.postingDateTime, { weekday: "long", month: "long", day: "numeric" })}</div>
          {editing ? <form className="post-form route-edit-form" onSubmit={saveAnnouncement}>
            <h2 id="detail-title">Edit route</h2>
            <fieldset><legend>Ad type</legend><div className="type-option chosen route-type-display"><span className="type-option-icon"><Icon name={announcement.type === "sender" ? "box" : "route"} size={20} /></span><span><b>{announcement.type === "sender" ? "I need a parcel delivered" : "I can deliver a parcel"}</b></span></div></fieldset>
            <div className="form-section"><h2>{needsCourier ? "Where does your parcel need to go?" : "Where are you going?"}</h2><div className="form-grid">
              <LocationAutocomplete label="Starting city" value={editForm.postingPlace} selectedLocation={editForm.origin} required onActivate={() => setActiveLocationKey("origin")} onChange={(value, location) => updateEditLocation("postingPlace", "origin", value, location)} />
              <LocationAutocomplete label="Destination city" value={editForm.receptionPlace} selectedLocation={editForm.destination} required onActivate={() => setActiveLocationKey("destination")} onChange={(value, location) => updateEditLocation("receptionPlace", "destination", value, location)} />
              <label>Leaving<input required type="datetime-local" value={editForm.postingDateTime} onChange={(event) => updateEditForm("postingDateTime", event.target.value)} /></label>
              <label>Arriving by<input required type="datetime-local" value={editForm.receptionDateTime} onChange={(event) => updateEditForm("receptionDateTime", event.target.value)} /></label>
            </div><p className="field-hint">Choose a suggestion to add its location automatically. Search uses Photon and © OpenStreetMap contributors.</p>
              <div className="location-map-heading"><b>Pick a location on the map</b><span>Active field: {activeLocationLabel}</span></div>
              <LocationMap locations={editMapLocations} activeKey={activeLocationKey} onMapPick={handleEditMapPick} />
              {mapError && <p className="form-error location-map-error" role="alert">{mapError}</p>}
            </div>
            <div className="form-section"><h2>A few more details</h2><div className="form-grid">
              <label className="full-span">Give your route a title<input required maxLength={150} value={editForm.title} onChange={(event) => updateEditForm("title", event.target.value)} /></label>
              <label className="full-span">Anything else people should know?<textarea rows="4" maxLength={2000} value={editForm.description} onChange={(event) => updateEditForm("description", event.target.value)} /></label>
            </div><label className="terms-field weight-toggle"><input type="checkbox" checked={editForm.includeWeight} onChange={(event) => updateEditForm("includeWeight", event.target.checked)} /><span>I can share a weight limit</span></label>{editForm.includeWeight && <label className="weight-input">Maximum weight ({measurementSystem === "imperial" ? "lb" : "kg"})<input type="number" min="0.1" step="0.1" value={editForm.weight} onChange={(event) => updateEditForm("weight", event.target.value)} /></label>}</div>
            <div className="form-section"><h2>Stops and parcel details</h2>
              <label className="terms-field weight-toggle"><input type="checkbox" checked={editForm.includeDimensions} onChange={(event) => updateEditForm("includeDimensions", event.target.checked)} /><span>I can share maximum parcel dimensions</span></label>
              {editForm.includeDimensions && <div className="form-grid dimensions-fields"><label>Width ({measurementSystem === "imperial" ? "in" : "cm"})<input type="number" min="0.1" step="0.1" required value={editForm.dimensions.width} onChange={(event) => setEditForm((current) => ({ ...current, dimensions: { ...current.dimensions, width: event.target.value } }))} /></label><label>Height ({measurementSystem === "imperial" ? "in" : "cm"})<input type="number" min="0.1" step="0.1" required value={editForm.dimensions.height} onChange={(event) => setEditForm((current) => ({ ...current, dimensions: { ...current.dimensions, height: event.target.value } }))} /></label><label>Length ({measurementSystem === "imperial" ? "in" : "cm"})<input type="number" min="0.1" step="0.1" required value={editForm.dimensions.length} onChange={(event) => setEditForm((current) => ({ ...current, dimensions: { ...current.dimensions, length: event.target.value } }))} /></label></div>}
              <div className="stops-heading"><p>Add optional pickup or meeting points; use the arrows to set their order.</p><button type="button" className="outline-button" disabled={editForm.stops.length >= 5} onClick={() => {
                const key = `edit-stop-${nextStopId.current++}`;
                setEditForm((current) => ({ ...current, stops: [...current.stops, { key, address: "", location: null }] }));
                setActiveLocationKey(key);
              }}><Icon name="plus" size={14} />Add stop</button></div>
              <SortableList items={editForm.stops} onChange={(stops) => setEditForm((current) => ({ ...current, stops }))} itemLabel="stop" listLabel="Stops in route order" getItemKey={(stop) => stop.key} renderItem={(stop) => (
                <div className="stop-row"><LocationAutocomplete label="Stop address" value={stop.address} selectedLocation={stop.location} required onActivate={() => setActiveLocationKey(stop.key)} onChange={(value, location) => {
                  setEditForm((current) => ({ ...current, stops: current.stops.map((item) => item.key === stop.key ? { ...item, address: value, location } : item) }));
                }} /><button type="button" className="remove-stop" aria-label="Remove stop" onClick={() => {
                  setEditForm((current) => ({ ...current, stops: current.stops.filter((item) => item.key !== stop.key) }));
                  if (activeLocationKey === stop.key) setActiveLocationKey("origin");
                }}><Icon name="close" size={15} /></button></div>
              )} />
            </div>
            <div className="route-edit-actions"><button className="outline-button" type="button" onClick={() => { setEditing(false); setPhotoError(""); setMapError(""); }}>Cancel</button><button className="dialog-primary" disabled={photoBusy}>{photoBusy ? "Saving..." : "Save route"}<Icon name="check" size={15} /></button></div>
          </form> : <h2 id="detail-title">{announcementTitle(announcement)}</h2>}
          {photos.length > 0 && <div className="photo-gallery">{photos.map((photo, index) => <div className="detail-photo" key={photo.id}><img src={photo.url} alt={`Route ${index + 1}`} />{String(user?.id) === String(announcement.userId) && <div className="photo-actions">{photo.position === 0 ? <span>Cover photo</span> : <button disabled={photoBusy} onClick={() => setMainPhoto(photo)}>Make cover</button>}<button disabled={photoBusy || index === 0} title="Move photo earlier" onClick={() => movePhoto(index, -1)} aria-label="Move photo earlier">↑</button><button disabled={photoBusy || index === photos.length - 1} title="Move photo later" onClick={() => movePhoto(index, 1)} aria-label="Move photo later">↓</button><button disabled={photoBusy} onClick={() => removePhoto(photo)} aria-label="Remove photo"><Icon name="close" size={14} /></button></div>}</div>)}</div>}
          {String(user?.id) === String(announcement.userId) && photos.length < 3 && <label className="add-photo-control"><Icon name="plus" size={15} />{photoBusy ? "Uploading..." : "Add parcel photos"}<input type="file" accept="image/jpeg,image/png" disabled={photoBusy} onChange={(event) => { addPhoto(event.target.files?.[0]); event.target.value = ""; }} /></label>}
          {photoError && <div className="form-error" role="alert">{photoError}</div>}
          {!editing && <div className="detail-route"><span className="route-point start" /><div><b>{announcement.postingPlace}</b><small>Starting point</small></div><span className="detail-route-line" /><span className="route-point end" /><div><b>{announcement.receptionPlace}</b><small>Destination</small></div></div>}
          {!editing && hasCoordinates(announcement.postingLatitude, announcement.postingLongitude)
            && hasCoordinates(announcement.receptionLatitude, announcement.receptionLongitude)
            && <div className="detail-map-section">
              <h3>Route overview</h3>
              <LocationMap
                readOnly
                locations={[
                  { key: "origin", label: `Starting point: ${announcement.postingPlace}`, location: { latitude: Number(announcement.postingLatitude), longitude: Number(announcement.postingLongitude) } },
                  ...sortStopsByPosition(announcement.stops || [])
                    .filter(({ stop }) => hasCoordinates(stop.latitude, stop.longitude))
                    .map(({ stop }, index) => ({
                      key: `stop-${index + 1}`,
                      label: `Stop ${index + 1}: ${stop.address}`,
                      location: { latitude: Number(stop.latitude), longitude: Number(stop.longitude) },
                    })),
                  { key: "destination", label: `Destination: ${announcement.receptionPlace}`, location: { latitude: Number(announcement.receptionLatitude), longitude: Number(announcement.receptionLongitude) } },
                ]}
              />
            </div>}
          {!editing && <div className="detail-schedule">
            {announcement.postingDateTime && <div><small>Leaving</small><time dateTime={announcement.postingDateTime}>{formatDate(announcement.postingDateTime, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>}
            {announcement.receptionDateTime && <div><small>Arriving by</small><time dateTime={announcement.receptionDateTime}>{formatDate(announcement.receptionDateTime, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>}
          </div>}
          {!editing && announcement.stops?.length > 0 && <div className="detail-stops">
            <h3>Stops along the way</h3>
            <ol>{sortStopsByPosition(announcement.stops)
              .map(({ stop }, index) => <li key={stop.id || `${stop.position}-${stop.address}`}><span>{index + 1}</span>{stop.address}</li>)}</ol>
          </div>}
          {!editing && announcementDescription(announcement) && <p className="detail-description">{announcementDescription(announcement)}</p>}
          {!editing && (announcement.weight?.value > 0 || announcement.dimensions?.width > 0) && <div className="detail-facts">
            {announcement.weight?.value > 0 && <span><Icon name="box" size={16} />Up to {formatStoredWeight(announcement.weight.value)}</span>}
            {announcement.dimensions?.width > 0 && <span><Icon name="box" size={16} />{formatStoredDimensions(announcement.dimensions)}</span>}
          </div>}
          {String(user?.id) === String(announcement.userId) ? <div className="owner-route-actions">{!editing && <button className="dialog-primary" onClick={() => { setEditForm(announcementEditForm(announcement)); setEditing(true); setPhotoError(""); }}><Icon name="user" size={15} />Edit route</button>}<button className="delete-route-button" disabled={photoBusy} onClick={deleteAnnouncement}>Remove this route</button></div> : <button className="dialog-primary" onClick={onContact}>{user ? "Message about this route" : "Sign in to get in touch"}<Icon name="arrow" size={17} /></button>}
          <p className="dialog-footnote">Keep your conversation on Wayline while you make a plan.</p>
        </div>
      </section>
    </div>
  );
}

function sortPhotosByPosition(photos) {
  if (!Array.isArray(photos)) return [];
  return photos
    .map((photo, index) => ({ photo, index }))
    .sort((left, right) => {
      const getPosition = ({ photo, index }) => {
        const position = Number(photo.position);
        return photo.position !== null && photo.position !== "" && Number.isFinite(position)
          ? position
          : index;
      };
      return getPosition(left) - getPosition(right) || left.index - right.index;
    })
    .map(({ photo }) => photo);
}

function sortStopsByPosition(stops) {
  return stops
    .map((stop, index) => ({ stop, index }))
    .sort((left, right) => {
      const getPosition = ({ stop, index }) => {
        const position = Number(stop.position);
        return stop.position !== null && stop.position !== "" && Number.isFinite(position)
          ? position
          : index;
      };
      return getPosition(left) - getPosition(right) || left.index - right.index;
    });
}

function AuthDialog({ initialMode, resetToken, onClose, onAuthenticated, onNotice }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: "", email: "", password: "", termsAccepted: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleElement, setGoogleElement] = useState(null);

  const googleCallback = useCallback(async (response) => {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest("/auth/google", { method: "POST", body: { idToken: response.credential } });
      onAuthenticated(result);
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }, [onAuthenticated]);

  useEffect(() => {
    const renderGoogleButton = () => {
      if (mode === "reset-request" || mode === "reset-confirm") return;
      if (!window.google?.accounts?.id || !googleElement) return;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: googleCallback });
      window.google.accounts.id.renderButton(googleElement, { theme: "outline", size: "large", shape: "pill", width: 340, text: "continue_with" });
    };
    renderGoogleButton();
    const script = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    script?.addEventListener("load", renderGoogleButton);
    return () => script?.removeEventListener("load", renderGoogleButton);
  }, [googleElement, googleCallback, mode]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        await apiRequest("/auth/register", {
          method: "POST",
          body: {
            name: form.name,
            email: form.email,
            password: form.password,
            termsAccepted: form.termsAccepted,
            locale: navigator.language?.toLowerCase().startsWith("pl") ? "pl" : "en",
            trap: "",
          },
        });
        onClose();
        onNotice("Account created. Check your email to verify your address before signing in.");
      } else if (mode === "reset-request") {
        const response = await apiRequest("/auth/reset/request", {
          method: "POST",
          body: { email: form.email, trap: "" },
        });
        setMode("login");
        onNotice(response?.message || "If the email is registered, password reset instructions are on their way.");
      } else if (mode === "reset-confirm") {
        const response = await apiRequest("/auth/reset/confirm", {
          method: "POST",
          body: { token: resetToken, password: form.password },
        });
        setMode("login");
        window.history.replaceState({}, "", "/");
        onNotice(response?.message || "Password reset complete. Sign in with your new password.");
      } else {
        const response = await apiRequest("/auth/login", { method: "POST", body: { email: form.email, password: form.password, trap: "" } });
        onAuthenticated(response);
      }
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Close sign in"><Icon name="close" size={20} /></button>
        <div className="auth-brand"><span className="brand-mark"><Icon name="route" size={19} /></span> wayline<span className="brand-period">.</span></div>
        <div className="eyebrow section-eyebrow">GOOD TO HAVE YOU HERE</div>
        <h2 id="auth-title">{mode === "reset-request" ? "Forgot your password?" : mode === "reset-confirm" ? "Choose a new password." : mode === "login" ? "Welcome back." : "Find your way in."}</h2>
        <p className="auth-subtitle">{mode === "reset-request" ? "Enter the email address on your account and we’ll send reset instructions." : mode === "reset-confirm" ? "Set a new password to get back to your Wayline account." : mode === "login" ? "Your next good connection is just around the corner." : "Join a community that makes every journey count."}</p>
        {(mode === "login" || mode === "register") && <div className="auth-tabs"><button className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); }}>Log in</button><button className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); }}>Create account</button></div>}
        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && <label>Your name<input autoComplete="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="What should we call you?" /></label>}
          {(mode === "login" || mode === "register" || mode === "reset-request") && <label>Email address<input type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" /></label>}
          {(mode === "login" || mode === "register" || mode === "reset-confirm") && <label>{mode === "reset-confirm" ? "New password" : "Password"}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 8 characters" /></label>}
          {mode === "register" && <label className="terms-field"><input type="checkbox" checked={form.termsAccepted} onChange={(event) => setForm({ ...form, termsAccepted: event.target.checked })} required /><span>I agree to the terms and understand how Wayline works.</span></label>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="dialog-primary auth-submit" disabled={busy}>{busy ? "One moment..." : mode === "reset-request" ? "Send reset instructions" : mode === "reset-confirm" ? "Update password" : mode === "login" ? "Log in to Wayline" : "Create my account"}<Icon name="arrow" size={17} /></button>
        </form>
        {mode === "login" && <button className="forgot-password" onClick={() => { setMode("reset-request"); setError(""); }}>Forgot your password?</button>}
        {(mode === "login" || mode === "register") && <><div className="auth-separator"><span />or continue with<span /></div><div className="google-button-container" ref={setGoogleElement} /><p className="privacy-note">Your details stay yours. We’re here to help people connect.</p></>}
        {(mode === "reset-request" || mode === "reset-confirm") && <button className="forgot-password back-to-login" onClick={() => { setMode("login"); setError(""); }}>Back to log in</button>}
      </section>
    </div>
  );
}

function PostRoute({ token, user, onRequireAuth, onPosted }) {
  const [form, setForm] = useState({ type: "courier", title: "", description: "", postingPlace: "", receptionPlace: "", postingDateTime: "", receptionDateTime: "" });
  const [measurementSystem] = useState(getMeasurementSystem);
  const [locations, setLocations] = useState({ origin: null, destination: null });
  const [activeLocationKey, setActiveLocationKey] = useState("origin");
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeWeight, setIncludeWeight] = useState(false);
  const [weight, setWeight] = useState("");
  const [includeDimensions, setIncludeDimensions] = useState(false);
  const [dimensions, setDimensions] = useState({ width: "", height: "", length: "" });
  const [stops, setStops] = useState([]);
  const [photos, setPhotos] = useState([]);
  const photoPreviewUrls = useRef(new Map());
  const nextPhotoId = useRef(1);
  const nextStopId = useRef(1);
  const reverseGeocodeController = useRef(null);

  useEffect(() => () => {
    reverseGeocodeController.current?.abort();
    photoPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  if (!token || !user) return <main className="post-page"><div className="post-auth"><span className="empty-icon"><Icon name="user" size={25} /></span><h1>Every delivery starts somewhere.</h1><p>Sign in or create an account to post an ad or offer to carry a parcel.</p><button className="dialog-primary" onClick={onRequireAuth}>Continue to sign in <Icon name="arrow" size={17} /></button></div></main>;

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateLocation = (field, key, value, location, preserveMapRequest = false) => {
    if (!preserveMapRequest) reverseGeocodeController.current?.abort();
    update(field, value);
    setLocations((current) => ({ ...current, [key]: location }));
    setActiveLocationKey(key);
    setMapError("");
    if (location) setError("");
  };
  const updateMapLocation = (key, location) => {
    if (key === "origin") {
      updateLocation("postingPlace", key, location.label, location, true);
    } else if (key === "destination") {
      updateLocation("receptionPlace", key, location.label, location, true);
    } else {
      setStops((current) => current.map((stop) => stop.id === key
        ? { ...stop, address: location.label, location }
        : stop));
      setActiveLocationKey(key);
      setMapError("");
      setError("");
    }
  };
  const handleMapPick = async ({ latitude, longitude }) => {
    const key = activeLocationKey;
    reverseGeocodeController.current?.abort();
    const controller = new AbortController();
    reverseGeocodeController.current = controller;
    const fallbackLocation = {
      id: `pin/${latitude},${longitude}`,
      label: `Pinned location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
      latitude,
      longitude,
    };
    updateMapLocation(key, fallbackLocation);

    try {
      const location = await reverseGeocodeLocation(latitude, longitude, { signal: controller.signal });
      if (!controller.signal.aborted) {
        updateMapLocation(key, location
          ? { ...location, latitude, longitude }
          : fallbackLocation);
      }
    } catch (failure) {
      if (failure.name !== "AbortError" && !controller.signal.aborted) {
        updateMapLocation(key, fallbackLocation);
        setMapError(`${failure.message || "Could not look up this place."} The map pin coordinates are still selected.`);
      }
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!locations.origin) {
      setError("Select a starting city from the suggestions.");
      return;
    }
    if (!locations.destination) {
      setError("Select a destination city from the suggestions.");
      return;
    }
    if (stops.some((stop) => !stop.location)) {
      setError("Select a suggested place for each stop, or remove that stop.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      type: form.type,
      userId: user.id,
      postingPlace: form.postingPlace,
      postingLatitude: locations.origin.latitude,
      postingLongitude: locations.origin.longitude,
      receptionPlace: form.receptionPlace,
      receptionLatitude: locations.destination.latitude,
      receptionLongitude: locations.destination.longitude,
      postingDateTime: form.postingDateTime,
      receptionDateTime: form.receptionDateTime,
      translations: [{ language: navigator.language?.toLowerCase().startsWith("pl") ? "pl" : "en", title: form.title, description: form.description }],
      ...(includeWeight && weight ? { weight: { value: Number(weight), unit: measurementSystem } } : {}),
      ...(includeDimensions ? {
        dimensions: {
          width: Number(dimensions.width),
          height: Number(dimensions.height),
          length: Number(dimensions.length),
          unit: measurementSystem,
        },
      } : {}),
      ...(stops.length ? {
        stops: stops.map((stop, position) => ({
          address: stop.address,
          latitude: stop.location.latitude,
          longitude: stop.location.longitude,
          position,
        })),
      } : {}),
    };
    try {
      const response = await apiRequest("/announcements", { method: "POST", token, body: payload });
      const created = response.announcement;
      const uploadedPhotos = [];
      const failures = [];
      const photosToUpload = form.type === "sender" ? photos : [];
      for (const { file } of photosToUpload) {
        try {
          const signed = await apiRequest(`/announcements/${created.id}/photos/presign`, {
            method: "POST",
            token,
            body: { contentType: file.type, fileSize: file.size },
          });
          await uploadFile(signed.uploadUrl, file);
          const photo = await apiRequest(`/announcements/${created.id}/photos`, {
            method: "POST",
            token,
            body: { fileUrl: signed.fileUrl, contentType: file.type, fileSize: file.size },
          });
          uploadedPhotos.push(photo);
        } catch (failure) {
          failures.push({ name: file.name, message: getErrorMessage(failure) });
        }
      }
      onPosted({ ...created, photos: uploadedPhotos }, failures);
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const mapLocations = [
    { key: "origin", label: `Starting city: ${form.postingPlace}`, location: locations.origin },
    ...stops.map((stop, index) => ({
      key: stop.id,
      label: `Stop ${index + 1}: ${stop.address}`,
      location: stop.location,
    })),
    { key: "destination", label: `Destination city: ${form.receptionPlace}`, location: locations.destination },
  ];
  const activeLocationLabel = activeLocationKey === "origin"
    ? "Starting city"
    : activeLocationKey === "destination"
      ? "Destination city"
      : `Stop ${stops.findIndex((stop) => stop.id === activeLocationKey) + 1}`;

  return (
    <main className="post-page">
      <div className="post-intro"><div className="eyebrow section-eyebrow">PARCELS, ON THEIR WAY</div><h1>Post a delivery ad.</h1><p>Offer to carry a parcel on a trip you’re taking, or find someone to deliver something for you.</p></div>
      <form className="post-form" onSubmit={submit}>
        <fieldset><legend>What would you like to do?</legend><div className="type-options">
          <button type="button" className={`type-option ${form.type === "courier" ? "chosen" : ""}`} onClick={() => update("type", "courier")}><span className="type-option-icon"><Icon name="route" size={20} /></span><span><b>I can deliver a parcel</b><small>I’m traveling this route and can carry something.</small></span><span className="radio-dot" /></button>
          <button type="button" className={`type-option ${form.type === "sender" ? "chosen" : ""}`} onClick={() => update("type", "sender")}><span className="type-option-icon"><Icon name="box" size={20} /></span><span><b>I need a parcel delivered</b><small>I have something to send along this route.</small></span><span className="radio-dot" /></button>
        </div></fieldset>
        <div className="form-section"><h2>Where are you going?</h2><div className="form-grid">
          <LocationAutocomplete
            label="Starting city"
            value={form.postingPlace}
            selectedLocation={locations.origin}
            required
            onActivate={() => setActiveLocationKey("origin")}
            onChange={(value, location) => updateLocation("postingPlace", "origin", value, location)}
          />
          <LocationAutocomplete
            label="Destination city"
            value={form.receptionPlace}
            selectedLocation={locations.destination}
            required
            onActivate={() => setActiveLocationKey("destination")}
            onChange={(value, location) => updateLocation("receptionPlace", "destination", value, location)}
          />
          <label>Leaving<input required type="datetime-local" value={form.postingDateTime} onChange={(event) => update("postingDateTime", event.target.value)} /></label>
          <label>Arriving by<input required type="datetime-local" value={form.receptionDateTime} onChange={(event) => update("receptionDateTime", event.target.value)} /></label>
        </div><p className="field-hint">Choose a suggestion to add its location automatically. Search uses Photon and © OpenStreetMap contributors.</p>
          <div className="location-map-heading"><b>Pick a location on the map</b><span>Active field: {activeLocationLabel}</span></div>
          <LocationMap locations={mapLocations} activeKey={activeLocationKey} onMapPick={handleMapPick} />
          {mapError && <p className="form-error location-map-error" role="alert">{mapError}</p>}
        </div>
        <div className="form-section"><h2>A few more details</h2><div className="form-grid">
          <label className="full-span">Give your route a title<input required maxLength={150} value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="A short, friendly headline" /></label>
          <label className="full-span">Anything else people should know?<textarea rows="4" maxLength={2000} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Share a little more about the journey..." /></label>
        </div><label className="terms-field weight-toggle"><input type="checkbox" checked={includeWeight} onChange={(event) => setIncludeWeight(event.target.checked)} /><span>I can share a weight limit</span></label>{includeWeight && <label className="weight-input">Maximum weight ({measurementSystem === "imperial" ? "lb" : "kg"})<input type="number" min="0.1" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder={measurementSystem === "imperial" ? "e.g. 22" : "e.g. 10"} /></label>}</div>
        <div className="form-section"><h2>Stops and parcel details</h2>
          <label className="terms-field weight-toggle"><input type="checkbox" checked={includeDimensions} onChange={(event) => setIncludeDimensions(event.target.checked)} /><span>I can share maximum parcel dimensions</span></label>
          {includeDimensions && <div className="form-grid dimensions-fields"><label>Width ({measurementSystem === "imperial" ? "in" : "cm"})<input type="number" min="0.1" step="0.1" required value={dimensions.width} onChange={(event) => setDimensions({ ...dimensions, width: event.target.value })} /></label><label>Height ({measurementSystem === "imperial" ? "in" : "cm"})<input type="number" min="0.1" step="0.1" required value={dimensions.height} onChange={(event) => setDimensions({ ...dimensions, height: event.target.value })} /></label><label>Length ({measurementSystem === "imperial" ? "in" : "cm"})<input type="number" min="0.1" step="0.1" required value={dimensions.length} onChange={(event) => setDimensions({ ...dimensions, length: event.target.value })} /></label></div>}
          <div className="stops-heading"><p>Add optional pickup or meeting points; use the arrows to set their order.</p><button type="button" className="outline-button" disabled={stops.length >= 5} onClick={() => {
            const id = `stop-${nextStopId.current++}`;
            setStops((current) => [...current, { id, address: "", location: null }]);
            setActiveLocationKey(id);
          }}><Icon name="plus" size={14} />Add stop</button></div>
          <SortableList
            items={stops}
            onChange={setStops}
            itemLabel="stop"
            listLabel="Stops in route order"
            getItemKey={(stop) => stop.id}
            renderItem={(stop) => (
              <div className="stop-row">
                <LocationAutocomplete label="Stop address" value={stop.address} selectedLocation={stop.location} required onActivate={() => setActiveLocationKey(stop.id)} onChange={(value, location) => {
                  reverseGeocodeController.current?.abort();
                  setActiveLocationKey(stop.id);
                  setStops((current) => current.map((item) => item.id === stop.id ? { ...item, address: value, location } : item));
                }} />
                <button type="button" className="remove-stop" aria-label="Remove stop" onClick={() => {
                  setStops((current) => current.filter((item) => item.id !== stop.id));
                  if (activeLocationKey === stop.id) setActiveLocationKey("origin");
                }}><Icon name="close" size={15} /></button>
              </div>
            )}
          />
        </div>
        {form.type === "sender" && <div className="form-section"><h2>Photos <span className="optional-label">optional · up to 3 JPG or PNG, 5 MB each</span></h2>
          <label className="photo-picker"> <Icon name="plus" size={17} /> Add parcel photos<input type="file" accept="image/jpeg,image/png" multiple disabled={photos.length >= 3} onChange={(event) => {
            const selected = Array.from(event.target.files || []);
            const invalidType = selected.find((file) => !["image/jpeg", "image/jpg", "image/png"].includes(file.type));
            const invalidSize = selected.find((file) => file.size > 5 * 1024 * 1024);
            if (invalidType) setError(`${invalidType.name} is not a JPG or PNG image.`);
            else if (invalidSize) setError(`${invalidSize.name} exceeds the 5 MB limit.`);
            else if (photos.length + selected.length > 3) setError("You can add up to 3 parcel photos.");
            else {
              setError("");
              const previews = selected.map((file) => {
                const previewUrl = URL.createObjectURL(file);
                photoPreviewUrls.current.set(file, previewUrl);
                return { id: `photo-${nextPhotoId.current++}`, file, previewUrl };
              });
              setPhotos((current) => [...current, ...previews]);
            }
            event.target.value = "";
          }} /></label>
          {photos.length > 0 && <div className="selected-files">
            <SortableList
              items={photos}
              onChange={setPhotos}
              itemLabel="photo"
              listLabel="Photos in upload order"
              renderItem={({ file, previewUrl, id }) => (
                <div className="selected-photo">
                  <img src={previewUrl} alt={`Preview of ${file.name}`} />
                  <span><Icon name="box" size={15} />{file.name}<small>{(file.size / (1024 * 1024)).toFixed(1)} MB</small></span>
                  <button type="button" aria-label={`Remove ${file.name}`} onClick={() => {
                    URL.revokeObjectURL(previewUrl);
                    photoPreviewUrls.current.delete(file);
                    setPhotos((current) => current.filter((photo) => photo.id !== id));
                  }}><Icon name="close" size={15} /></button>
                </div>
              )}
            />
          </div>}
        </div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="post-submit"><span><Icon name="check" size={16} />Your contact details stay private.</span><button className="dialog-primary" disabled={busy}>{busy ? "Publishing..." : "Publish ad"}<Icon name="arrow" size={17} /></button></div>
      </form>
    </main>
  );
}

function ConversationPanel({
  conversation,
  messages,
  error,
  token,
  user,
  role,
  isSupport,
  onSend,
  onBlock,
  onDeleteMessage,
  onReact,
  onAttachment,
  onSearchResults,
  onRefreshMessages,
  onSearchReset,
  onUnreadCount,
  hasMore,
  loadingOlder,
  onLoadOlder,
}) {
  const [content, setContent] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [connection, setConnection] = useState("connecting");
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [typingSent, setTypingSent] = useState(false);
  const socketRef = useRef(null);
  const stopTypingTimer = useRef(null);
  const lastReadId = useRef(null);
  const attachmentInput = useRef(null);
  const other = conversation.participants?.find((person) => String(person.id) !== String(user?.id)) || conversation.participants?.[0];
  const sendTypingEvent = (type) => apiRequest("/typing", {
    method: "POST",
    token,
    body: { conversationId: conversation.id, type },
  });

  useEffect(() => {
    if (!token || !conversation?.id) return undefined;
    let active = true;
    let refreshTimer;
    let socket;
    try {
      socket = new WebSocket(getWebSocketUrl(`/ws/chat/${conversation.id}?token=${encodeURIComponent(token)}`));
      socketRef.current = socket;
      socket.onopen = () => active && setConnection("connected");
      socket.onerror = () => active && setConnection("unavailable");
      socket.onclose = () => active && setConnection("disconnected");
      socket.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (payload.conversationId && String(payload.conversationId) !== String(conversation.id)) return;
        if (payload.event === "TYPING_START" && String(payload.userId) !== String(user?.id)) setTyping(true);
        if (payload.event === "TYPING_STOP" && String(payload.userId) !== String(user?.id)) setTyping(false);
        if (payload.event === "UNREAD_COUNT_UPDATE") onUnreadCount(conversation.id, payload.unreadCount);
        if (payload.event === "READ" && String(payload.userId) === String(user?.id)) onUnreadCount(conversation.id, 0);
        if (["MESSAGE", "REACTION", "ATTACHMENT", "DELETED", "READ", "DELIVERED"].includes(payload.event)) {
          window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(onRefreshMessages, 100);
        }
      };
    } catch {
      setConnection("unavailable");
    }
    return () => {
      active = false;
      window.clearTimeout(refreshTimer);
      if (socketRef.current === socket) socketRef.current = null;
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close();
    };
  }, [conversation, onRefreshMessages, onUnreadCount, token, user?.id]);

  useEffect(() => {
    const latestIncoming = [...messages]
      .filter((message) => String(message.senderId) !== String(user?.id))
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0];
    if (!latestIncoming || String(lastReadId.current) === String(latestIncoming.id)) return;
    lastReadId.current = latestIncoming.id;
    apiRequest("/events", {
      method: "POST",
      token,
      body: { conversationId: conversation.id, messageId: latestIncoming.id, type: "READ" },
    }).catch((failure) => {
      setSendError(getErrorMessage(failure));
    });
  }, [conversation.id, messages, token, user?.id]);

  useEffect(() => () => window.clearTimeout(stopTypingTimer.current), []);

  const handleTyping = (value) => {
    setContent(value);
    if (!value.trim()) {
      if (typingSent) sendTypingEvent("TYPING_STOP").catch(() => {});
      setTypingSent(false);
      window.clearTimeout(stopTypingTimer.current);
      return;
    }
    if (!typingSent) {
      setTypingSent(true);
      sendTypingEvent("TYPING_START").catch((failure) => setSendError(getErrorMessage(failure)));
    }
    window.clearTimeout(stopTypingTimer.current);
    stopTypingTimer.current = window.setTimeout(() => {
      sendTypingEvent("TYPING_STOP").catch((failure) => setSendError(getErrorMessage(failure)));
      setTypingSent(false);
    }, 2200);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    setSendError("");
    try {
      await onSend(content.trim());
      setContent("");
      setTypingSent(false);
    } catch (failure) {
      setSendError(getErrorMessage(failure));
    } finally {
      setSending(false);
    }
  };

  const uploadAttachments = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (files.length > 10) {
      setSendError("You can attach up to 10 files to a message.");
      return;
    }
    const invalidFile = files.find((file) => file.size > 5 * 1024 * 1024 || !isAllowedAttachmentType(file.type));
    if (invalidFile) {
      setSendError(invalidFile.size > 5 * 1024 * 1024
        ? `${invalidFile.name} exceeds the 5 MB limit.`
        : `${invalidFile.name} has an unsupported file type.`);
      return;
    }
    setSending(true);
    setSendError("");
    try {
      const sent = await onSend(content.trim() || "Shared an attachment.");
      setContent("");
      await onAttachment(sent.id, files);
    } catch (failure) {
      setSendError(getErrorMessage(failure));
    } finally {
      setSending(false);
    }
  };

  const startSearch = async (event) => {
    event.preventDefault();
    if (!search.trim()) return;
    setSearchError("");
    try {
      const result = await apiRequest(`/conversations/${conversation.id}/search?query=${encodeURIComponent(search.trim())}&limit=50`, { token });
      onSearchResults(result.messages || []);
    } catch (failure) {
      setSearchError(getErrorMessage(failure));
    }
  };

  return <div className="chat-panel">
    <div className="chat-header"><span className="avatar">{other?.photoUrl ? <img src={other.photoUrl} alt="" /> : (other?.name || "U").slice(0, 1).toUpperCase()}</span><div><b>{isSupport && role === "ADMIN" ? other?.name || "Member" : isSupport ? "Wayline Support" : other?.name || "Wayline member"}</b><small>{connection === "connected" ? "Live connection" : conversation.otherUserOnline ? "Online now" : "A Wayline conversation"}</small></div>{!isSupport && <form className="chat-search" onSubmit={startSearch}><input aria-label="Search this conversation" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" /><button aria-label="Search messages"><Icon name="search" size={15} /></button>{search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); setSearchError(""); onSearchReset(); }}><Icon name="close" size={13} /></button>}</form>}<span className="chat-header-badge"><Icon name="check" size={14} />{connection === "connected" ? "Live chat" : "Private chat"}</span>{!isSupport && other?.id && <button className="block-user-button" onClick={async () => {
      if (!window.confirm(`Block ${other.name || "this member"}? They will no longer be able to message you.`)) return;
      try {
        await onBlock(other.id, blocked);
        setBlocked((current) => !current);
      } catch (failure) {
        setSendError(getErrorMessage(failure));
      }
    }}>{blocked ? "Unblock" : "Block"}</button>}</div>
    {searchError && <p className="chat-error">{searchError}</p>}
    <div className="chat-messages">
      <div className="chat-date">A good place to start</div>
      {hasMore && <button className="load-older-button" disabled={loadingOlder} onClick={onLoadOlder}>{loadingOlder ? "Loading earlier messages..." : "Load earlier messages"}</button>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      {messages.map((message) => {
        const mine = String(message.senderId) === String(user?.id);
        const myReaction = message.reactions?.find((reaction) => String(reaction.userId) === String(user?.id))?.reaction;
        return <div key={message.id} className={`chat-message ${mine ? "mine" : ""}`}>
          <p>{message.content}</p>
          {message.attachments?.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => attachment.type?.startsWith("image/") ? <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer"><img src={attachment.url} alt="Shared attachment" /></a> : <a className="attachment-link" key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer"><Icon name="box" size={15} />{attachment.type?.split("/").pop() || "Download file"} · {(attachment.size / 1024).toFixed(0)} KB</a>)}</div>}
          <div className="message-meta"><time>{formatDate(message.createdAt, { hour: "numeric", minute: "2-digit" })}</time>{mine && <button title="Delete message for everyone" onClick={async () => {
            if (!window.confirm("Delete this message?")) return;
            try { await onDeleteMessage(message.id); } catch (failure) { setSendError(getErrorMessage(failure)); }
          }}>Delete</button>}</div>
          <div className="reaction-bar">{["👍", "❤️", "😂", "🙏"].map((reaction) => <button key={reaction} className={myReaction === reaction ? "reacted" : ""} title={`React ${reaction}`} onClick={async () => {
            try { await onReact(message.id, myReaction === reaction ? null : reaction); } catch (failure) { setSendError(getErrorMessage(failure)); }
          }}>{reaction}<span>{message.reactions?.filter((item) => item.reaction === reaction).length || ""}</span></button>)}</div>
        </div>;
      })}
      {typing && <div className="typing-indicator"><i /><i /><i />{other?.name || "They"} is typing</div>}
      {!messages.length && !error && <div className="chat-welcome"><Icon name="message" size={23} /><p>Say hello and start planning your journey together.</p></div>}
    </div>
    <form className="chat-compose" onSubmit={submit}><input ref={attachmentInput} type="file" multiple hidden onChange={uploadAttachments} /><button type="button" className="attach-button" aria-label="Attach files" title="Attach files (max 5 MB each)" disabled={sending || blocked} onClick={() => attachmentInput.current?.click()}><Icon name="plus" size={19} /></button><input aria-label="Write a message" value={content} maxLength="2000" disabled={blocked} onChange={(event) => handleTyping(event.target.value)} placeholder={blocked ? "This conversation is blocked." : "Write a message..."} /><button disabled={!content.trim() || sending || blocked} aria-label="Send message"><Icon name="arrow" size={19} /></button></form>
    {(sendError || !token || connection === "unavailable") && <p className="chat-error">{sendError || (!token ? "Sign in to send messages." : "Live updates are unavailable. Messages can still be sent.")}</p>}
  </div>;
}

export default App;
