import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

import { apiUrl } from "./api";
import styles from "./App.module.css";

type Status =
  | "intake"
  | "bank_connected"
  | "reviewing"
  | "approved"
  | "denied"
  | "funded"
  | "repayment_scheduled"
  | "repaid"
  | "repayment_failed";

interface Application {
  id: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    employer: string;
  };
  requested_amount: number;
  payday: string;
  status: Status;
  plaid_connected: boolean;
  repayment: null | {
    amount: number;
    due_date: string;
    status: string;
    note: string;
    created_at: string;
  };
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  sender: "customer" | "admin" | "system";
  text: string;
  created_at: string;
}

interface BankSnapshot {
  accounts: Array<{
    account_id: string;
    name: string;
    mask: string | null;
    subtype: string | null;
    balances: {
      available: number | null;
      current: number | null;
      iso_currency_code: string | null;
    };
  }>;
  transactions: Array<{
    transaction_id: string;
    name: string;
    amount: number;
    date: string;
  }>;
  auth: unknown;
}

const applicationStorageKey = "advance_application_id";
const adminTokenStorageKey = "advance_admin_token";

const statusLabel: Record<Status, string> = {
  intake: "Intake",
  bank_connected: "Bank connected",
  reviewing: "Reviewing",
  approved: "Approved",
  denied: "Denied",
  funded: "Funded",
  repayment_scheduled: "Repayment scheduled",
  repaid: "Repaid",
  repayment_failed: "Repayment failed",
};

const formatMoney = (amount: number | null | undefined) => {
  if (amount == null) return "Unavailable";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
};

const today = new Date().toISOString().slice(0, 10);

const App = () => {
  const isAdmin = window.location.pathname === "/admin";
  return isAdmin ? <AdminApp /> : <CustomerApp />;
};

const CustomerApp = () => {
  const [application, setApplication] = useState<Application | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    employer: "",
    payday: "",
  });
  const [messageText, setMessageText] = useState("");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApplication = useCallback(async (id: string) => {
    const response = await fetch(apiUrl(`/api/advance/applications/${id}`));
    if (!response.ok) {
      localStorage.removeItem(applicationStorageKey);
      return;
    }
    const data = await response.json();
    setApplication(data.application);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const response = await fetch(apiUrl(`/api/advance/applications/${id}/messages`));
    if (!response.ok) return;
    const data = await response.json();
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    const applicationId = localStorage.getItem(applicationStorageKey);
    if (applicationId) {
      loadApplication(applicationId);
      loadMessages(applicationId);
    }
  }, [loadApplication, loadMessages]);

  useEffect(() => {
    if (!application?.id) return;
    const interval = window.setInterval(() => {
      loadApplication(application.id);
      loadMessages(application.id);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [application?.id, loadApplication, loadMessages]);

  const createApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/api/advance/applications"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          requested_amount: 50,
        }),
      });
      if (!response.ok) throw new Error("Unable to start application");
      const data = await response.json();
      localStorage.setItem(applicationStorageKey, data.application.id);
      setApplication(data.application);
      await loadMessages(data.application.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong");
    } finally {
      setIsBusy(false);
    }
  };

  const createLinkToken = async () => {
    if (!application) return;
    setIsBusy(true);
    setError(null);
    try {
      const response = await fetch(
        apiUrl(`/api/advance/applications/${application.id}/create_link_token`),
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Unable to create Plaid Link session");
      const data = await response.json();
      setLinkToken(data.link_token);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Plaid Link failed");
    } finally {
      setIsBusy(false);
    }
  };

  const onPlaidSuccess = useCallback(
    async (publicToken: string) => {
      if (!application) return;
      const response = await fetch(
        apiUrl(`/api/advance/applications/${application.id}/set_access_token`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        },
      );
      const data = await response.json();
      setApplication(data.application);
      await loadMessages(application.id);
      setLinkToken(null);
    },
    [application, loadMessages],
  );

  const plaidConfig = useMemo(
    () => ({
      token: linkToken,
      onSuccess: onPlaidSuccess,
    }),
    [linkToken, onPlaidSuccess],
  );
  const { open, ready } = usePlaidLink(plaidConfig);

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, open, ready]);

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!application || !messageText.trim()) return;
    const text = messageText.trim();
    setMessageText("");
    await fetch(apiUrl(`/api/advance/applications/${application.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "customer", text }),
    });
    await loadMessages(application.id);
  };

  if (!application) {
    const starterMessages: Message[] = [
      {
        id: "welcome",
        sender: "admin",
        text: "Hi, welcome. I can help you request a $50 earned wage advance.",
        created_at: "",
      },
      {
        id: "how-it-works",
        sender: "admin",
        text: "First I need a few details, then you will connect your bank with Plaid so a human reviewer can check income, balance, and recent activity.",
        created_at: "",
      },
      {
        id: "security",
        sender: "system",
        text: "Never send your bank login password. If approved, the reviewer may ask for routing and account details here for manual payout.",
        created_at: "",
      },
    ];

    return (
      <main className={styles.page}>
        <section className={styles.chatOnly}>
          <section className={styles.chat}>
            <header>
              <p className={styles.kicker}>Live review chat</p>
              <h1>$50 cash advance</h1>
            </header>
            <MessageList messages={starterMessages} />
            <form className={styles.intakeComposer} onSubmit={createApplication}>
              <div className={styles.intakeGrid}>
                <label>
                  Full name
                  <input
                    required
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </label>
                <label>
                  Email
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                  />
                </label>
                <label>
                  Phone
                  <input
                    required
                    value={form.phone}
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  />
                </label>
                <label>
                  Employer
                  <input
                    required
                    value={form.employer}
                    onChange={(event) => setForm({ ...form, employer: event.target.value })}
                  />
                </label>
                <label>
                  Next payday
                  <input
                    required
                    min={today}
                    type="date"
                    value={form.payday}
                    onChange={(event) => setForm({ ...form, payday: event.target.value })}
                  />
                </label>
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <button disabled={isBusy}>{isBusy ? "Starting..." : "Continue to bank connection"}</button>
            </form>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace}>
        <aside className={styles.summary}>
          <p className={styles.kicker}>Application</p>
          <h2>{formatMoney(application.requested_amount)}</h2>
          <div className={styles.status}>{statusLabel[application.status]}</div>
          <dl>
            <dt>Name</dt>
            <dd>{application.customer.name}</dd>
            <dt>Employer</dt>
            <dd>{application.customer.employer}</dd>
            <dt>Payday</dt>
            <dd>{application.payday}</dd>
            <dt>Bank</dt>
            <dd>{application.plaid_connected ? "Connected" : "Not connected"}</dd>
          </dl>
          <button disabled={isBusy || application.plaid_connected} onClick={createLinkToken}>
            {application.plaid_connected ? "Bank connected" : "Connect bank"}
          </button>
          {application.repayment && (
            <p className={styles.notice}>
              Repayment recorded for {application.repayment.due_date}.
            </p>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </aside>
        <section className={styles.chat}>
          <header>
            <p className={styles.kicker}>Live review chat</p>
            <h1>Continue your review</h1>
            <p>Connect your bank with Plaid, then a human reviewer will reply here.</p>
          </header>
          <MessageList messages={messages} />
          {!application.plaid_connected && (
            <div className={styles.chatAction}>
              <p>Next step: connect your bank securely with Plaid so the reviewer can make a decision.</p>
              <button disabled={isBusy} onClick={createLinkToken}>
                Connect bank with Plaid
              </button>
            </div>
          )}
          <form className={styles.composer} onSubmit={sendMessage}>
            <input
              placeholder="Type a message..."
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
            />
            <button>Send</button>
          </form>
        </section>
      </section>
    </main>
  );
};

const AdminApp = () => {
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem(adminTokenStorageKey) || "",
  );
  const [tokenInput, setTokenInput] = useState(adminToken);
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [snapshot, setSnapshot] = useState<BankSnapshot | null>(null);
  const [repaymentDate, setRepaymentDate] = useState(today);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = applications.find((application) => application.id === selectedId) || null;
  const adminHeaders = useMemo<Record<string, string>>(
    () => {
      const headers: Record<string, string> = {};
      if (adminToken) headers["x-admin-token"] = adminToken;
      return headers;
    },
    [adminToken],
  );

  const unlockAdmin = (event: React.FormEvent) => {
    event.preventDefault();
    sessionStorage.setItem(adminTokenStorageKey, tokenInput);
    setAdminToken(tokenInput);
  };

  const loadApplications = useCallback(async () => {
    const response = await fetch(apiUrl("/api/advance/admin/applications"), {
      headers: adminHeaders,
    });
    if (!response.ok) return;
    const data = await response.json();
    setApplications(data.applications);
    setSelectedId((current) => current || data.applications[0]?.id || null);
  }, [adminHeaders]);

  const loadMessages = useCallback(async (id: string) => {
    const response = await fetch(apiUrl(`/api/advance/applications/${id}/messages`));
    if (!response.ok) return;
    const data = await response.json();
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    loadApplications();
    const interval = window.setInterval(loadApplications, 4000);
    return () => window.clearInterval(interval);
  }, [loadApplications]);

  useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
    setSnapshot(null);
  }, [selectedId, loadMessages]);

  const sendAdminMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !messageText.trim()) return;
    const text = messageText.trim();
    setMessageText("");
    await fetch(apiUrl(`/api/advance/applications/${selected.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders },
      body: JSON.stringify({ sender: "admin", text }),
    });
    await loadMessages(selected.id);
  };

  const setStatus = async (status: Status, note?: string) => {
    if (!selected) return;
    setIsBusy(true);
    await fetch(apiUrl(`/api/advance/admin/applications/${selected.id}/status`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders },
      body: JSON.stringify({ status, note }),
    });
    await loadApplications();
    await loadMessages(selected.id);
    setIsBusy(false);
  };

  const loadBankSnapshot = async () => {
    if (!selected) return;
    setIsBusy(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/api/advance/admin/applications/${selected.id}/bank_snapshot`), {
        headers: adminHeaders,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.error_message || "Unable to load bank details");
      setSnapshot(data);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load bank details");
    } finally {
      setIsBusy(false);
    }
  };

  const scheduleRepayment = async () => {
    if (!selected) return;
    setIsBusy(true);
    await fetch(apiUrl(`/api/advance/admin/applications/${selected.id}/repayment`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders },
      body: JSON.stringify({ amount: 50, due_date: repaymentDate }),
    });
    await loadApplications();
    await loadMessages(selected.id);
    setIsBusy(false);
  };

  return (
    <main className={styles.page}>
      {!adminToken && (
        <section className={styles.shell}>
          <div className={styles.intro}>
            <p className={styles.kicker}>Admin</p>
            <h1>Review console</h1>
            <p>Enter the admin token configured on the backend.</p>
          </div>
          <form className={styles.panel} onSubmit={unlockAdmin}>
            <label>
              Admin token
              <input
                type="password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
              />
            </label>
            <button>Open admin</button>
          </form>
        </section>
      )}
      {adminToken && (
      <section className={styles.adminLayout}>
        <aside className={styles.inbox}>
          <h1>Reviews</h1>
          {applications.map((application) => (
            <button
              key={application.id}
              className={application.id === selectedId ? styles.activeRow : styles.row}
              onClick={() => setSelectedId(application.id)}
            >
              <span>{application.customer.name || "Unnamed applicant"}</span>
              <small>{statusLabel[application.status]}</small>
            </button>
          ))}
        </aside>
        {selected ? (
          <section className={styles.review}>
            <div className={styles.reviewHeader}>
              <div>
                <p className={styles.kicker}>Manual decision</p>
                <h2>{selected.customer.name}</h2>
                <p>
                  {selected.customer.email} · {selected.customer.phone}
                </p>
              </div>
              <div className={styles.status}>{statusLabel[selected.status]}</div>
            </div>
            <div className={styles.reviewGrid}>
              <section className={styles.panel}>
                <h3>Applicant</h3>
                <dl>
                  <dt>Requested</dt>
                  <dd>{formatMoney(selected.requested_amount)}</dd>
                  <dt>Employer</dt>
                  <dd>{selected.customer.employer}</dd>
                  <dt>Payday</dt>
                  <dd>{selected.payday}</dd>
                  <dt>Plaid</dt>
                  <dd>{selected.plaid_connected ? "Connected" : "Waiting"}</dd>
                </dl>
                <div className={styles.actions}>
                  <button disabled={isBusy} onClick={loadBankSnapshot}>Load bank details</button>
                  <button
                    disabled={isBusy}
                    onClick={() =>
                      setStatus(
                        "approved",
                        "Congrats, you are approved for a $50 advance. To send the funds manually, please reply with: routing number, account number, checking or savings, and the legal name on the account. Do not send your online banking password.",
                      )
                    }
                  >
                    Approve
                  </button>
                  <button disabled={isBusy} onClick={() => setStatus("denied", "We are unable to approve this advance right now.")}>Deny</button>
                  <button disabled={isBusy} onClick={() => setStatus("funded", "Your $50 advance has been sent manually.")}>Mark funded</button>
                </div>
                <div className={styles.repayment}>
                  <label>
                    Repayment date
                    <input
                      type="date"
                      min={today}
                      value={repaymentDate}
                      onChange={(event) => setRepaymentDate(event.target.value)}
                    />
                  </label>
                  <button disabled={isBusy} onClick={scheduleRepayment}>Record repayment schedule</button>
                </div>
                {error && <p className={styles.error}>{error}</p>}
              </section>
              <section className={styles.panel}>
                <h3>Bank snapshot</h3>
                {!snapshot ? (
                  <p className={styles.muted}>Load bank details after the applicant connects Plaid.</p>
                ) : (
                  <BankSnapshotView snapshot={snapshot} />
                )}
              </section>
            </div>
            <section className={styles.chat}>
              <header>
                <h3>Chat</h3>
              </header>
              <MessageList messages={messages} />
              <form className={styles.composer} onSubmit={sendAdminMessage}>
                <input
                  placeholder="Reply to applicant..."
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                />
                <button>Send</button>
              </form>
            </section>
          </section>
        ) : (
          <section className={styles.empty}>No applications yet.</section>
        )}
      </section>
      )}
    </main>
  );
};

const MessageList = ({ messages }: { messages: Message[] }) => (
  <div className={styles.messages}>
    {messages.map((message) => (
      <div key={message.id} className={`${styles.message} ${styles[message.sender]}`}>
        <span>{message.sender}</span>
        <p>{message.text}</p>
      </div>
    ))}
  </div>
);

const BankSnapshotView = ({ snapshot }: { snapshot: BankSnapshot }) => (
  <div className={styles.snapshot}>
    <h4>Accounts</h4>
    {snapshot.accounts.map((account) => (
      <div key={account.account_id} className={styles.account}>
        <strong>{account.name}</strong>
        <span>
          {account.subtype || "account"} · {account.mask || "no mask"}
        </span>
        <span>Available {formatMoney(account.balances.available)}</span>
        <span>Current {formatMoney(account.balances.current)}</span>
      </div>
    ))}
    <h4>Recent transactions</h4>
    {snapshot.transactions.slice(0, 8).map((transaction) => (
      <div key={transaction.transaction_id} className={styles.transaction}>
        <span>{transaction.date}</span>
        <strong>{transaction.name}</strong>
        <span>{formatMoney(transaction.amount)}</span>
      </div>
    ))}
  </div>
);

export default App;
