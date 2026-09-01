"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, Pencil, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { api } from "../api";
import { EntityDialog, ErrorState, Field, LoadingState, PageHeader, Panel, useResource } from "../shared";
import type { AuthUser, UserRole } from "../types";

type DialogMode = "create" | "edit" | "password" | null;

function formatAccountDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function PasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input">
      <Input required minLength={8} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" />
      <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</button>
    </div>
  );
}

export function AdminDashboardPage({ currentUser }: { currentUser: AuthUser }) {
  const resource = useResource(() => api.adminUsers(), []);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [selected, setSelected] = useState<AuthUser | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setSelected(null); setUsername(""); setEmail(""); setPassword(""); setRole("user"); setActive(true); setDialog("create");
  };
  const openEdit = (user: AuthUser) => {
    setSelected(user); setUsername(user.username); setEmail(user.email); setRole(user.role); setActive(user.is_active); setDialog("edit");
  };
  const openPassword = (user: AuthUser) => { setSelected(user); setPassword(""); setDialog("password"); };

  const close = () => { if (!saving) setDialog(null); };

  const saveUser = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = dialog === "create"
        ? await api.adminCreateUser({ username, email, password, role })
        : await api.adminUpdateUser(selected!.id, { username, email, role, is_active: active });
      toast.success(result.message, { description: `${result.user.username} · ${result.user.email}` });
      setDialog(null);
      await resource.reload();
    } catch (caught) {
      toast.error(dialog === "create" ? "Could not create user" : "Could not update user", { description: caught instanceof Error ? caught.message : "Please try again" });
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const result = await api.adminResetPassword(selected.id, password);
      toast.success("Password updated", { description: result.message });
      setDialog(null);
    } catch (caught) {
      toast.error("Could not reset password", { description: caught instanceof Error ? caught.message : "Please try again" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell admin-page">
      <PageHeader eyebrow="Restricted access" title="Admin dashboard" description="Manage approved accounts, roles, profile details, and password access." actions={<Button className="neon-button" onClick={openCreate}><UserPlus />Create user</Button>} />
      {resource.loading && !resource.data ? <LoadingState label="Loading approved users..." /> : null}
      {resource.error && !resource.data ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : null}
      {resource.data ? (
        <>
          <div className="admin-metrics">
            <Panel><span><Users /></span><div><small>Approved users</small><strong>{resource.data.total}</strong></div></Panel>
            <Panel><span><ShieldCheck /></span><div><small>Administrators</small><strong>{resource.data.admins}</strong></div></Panel>
            <Panel><span><Users /></span><div><small>Users</small><strong>{resource.data.regular_users}</strong></div></Panel>
          </div>
          <div className="admin-user-list">
            {resource.data.users.map((user) => (
              <article className="admin-user-card" key={user.id}>
                <div className="user-avatar" aria-hidden="true">{user.username.slice(0, 2).toUpperCase()}</div>
                <div className="user-primary"><div><h2>{user.username}</h2>{user.id === currentUser.id ? <span className="you-pill">You</span> : null}<span className={`role-pill role-${user.role}`}>{user.role}</span></div><a href={`mailto:${user.email}`}>{user.email}</a></div>
                <dl><div><dt>Joined</dt><dd>{formatAccountDate(user.created_at)}</dd></div><div><dt>Last login</dt><dd>{formatAccountDate(user.last_login_at)}</dd></div></dl>
                <div className="admin-user-actions"><Button variant="outline" onClick={() => openEdit(user)}><Pencil />Edit</Button><Button variant="outline" onClick={() => openPassword(user)}><KeyRound />Password</Button></div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      <EntityDialog open={dialog === "create" || dialog === "edit"} onOpenChange={(open) => { if (!open) close(); }} title={dialog === "create" ? "Create approved user" : `Edit ${selected?.username ?? "user"}`} description={dialog === "create" ? "This account is approved immediately and does not require email verification." : "Update profile details, access level, or account status."}>
        <form className="entity-form" onSubmit={saveUser}>
          <div className="form-grid two-columns"><Field label="Username"><Input required minLength={2} maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} /></Field><Field label="Email"><Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field></div>
          <Field label="Role"><Select value={role} onValueChange={(value) => setRole(value as UserRole)}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">User</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select></Field>
          {dialog === "create" ? <Field label="Temporary password" hint="At least eight characters. Share it securely with the user."><PasswordField value={password} onChange={setPassword} /></Field> : <label className="admin-active-switch"><Switch checked={active} disabled={selected?.id === currentUser.id} onCheckedChange={setActive} /><span><strong>Account active</strong><small>{selected?.id === currentUser.id ? "You cannot deactivate your own account." : "Inactive accounts cannot sign in."}</small></span></label>}
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button className="neon-button" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : dialog === "create" ? <UserPlus /> : <Pencil />}{saving ? "Saving..." : dialog === "create" ? "Create user" : "Save changes"}</Button></div>
        </form>
      </EntityDialog>

      <EntityDialog open={dialog === "password"} onOpenChange={(open) => { if (!open) close(); }} title={`Reset ${selected?.username ?? "user"}'s password`} description="The user's other signed-in sessions will be closed after the password changes.">
        <form className="entity-form" onSubmit={resetPassword}><Field label="New password" hint="Use at least eight characters."><PasswordField value={password} onChange={setPassword} /></Field><div className="dialog-actions"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button className="neon-button" disabled={saving}><KeyRound />{saving ? "Updating..." : "Update password"}</Button></div></form>
      </EntityDialog>
    </div>
  );
}
