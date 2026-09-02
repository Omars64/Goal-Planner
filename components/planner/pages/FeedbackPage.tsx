"use client";

import Image from "next/image";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ChevronRight, Clock3, ImageIcon, ImagePlus, Inbox, LoaderCircle, Mail, MessageSquareText, Send, UserRound, X, ZoomIn } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { api } from "../api";
import { formatDateTime } from "../date";
import { prepareImage } from "../image";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel, useResource } from "../shared";
import type { AuthUser, PlannerFeedback } from "../types";

function FeedbackListItem({ item, selected, onSelect }: { item: PlannerFeedback; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`feedback-list-item ${selected ? "is-selected" : ""}`} type="button" aria-pressed={selected} onClick={onSelect}>
      <span className="feedback-list-avatar"><UserRound /></span>
      <span className="feedback-list-copy">
        <strong>{item.name}</strong>
        <span className="feedback-email"><Mail />{item.email}</span>
        <time dateTime={item.created_at}><Clock3 />{formatDateTime(item.created_at)}</time>
        {item.image ? <span className="feedback-attachment"><ImageIcon />Image attached</span> : null}
      </span>
      <ChevronRight className="feedback-list-chevron" aria-hidden="true" />
    </button>
  );
}

function FeedbackReader({ item, adminView, onClose, onZoom }: { item: PlannerFeedback; adminView: boolean; onClose: () => void; onZoom: (src: string, alt: string) => void }) {
  return (
    <article className="feedback-reader-message">
      <header>
        <div className="feedback-identity">
          <span><UserRound /></span>
          <div>
            <p>Feedback from</p>
            <h2>{item.name}</h2>
            <a className="feedback-reader-email" href={`mailto:${item.email}`}><Mail />{item.email}</a>
          </div>
        </div>
        <div className="feedback-reader-actions">
          <time dateTime={item.created_at}><Clock3 />{formatDateTime(item.created_at)}</time>
          <Button variant="ghost" size="icon-sm" aria-label="Close feedback details" title="Close details" onClick={onClose}><X /></Button>
        </div>
      </header>
      {adminView ? <div className="feedback-account"><strong>Planner account</strong><span>{item.account_username} · {item.account_email}</span></div> : null}
      <p className="feedback-reader-body">{item.message}</p>
      {item.image ? (
        <button className="feedback-image-button" type="button" onClick={() => onZoom(item.image!, `Attachment from ${item.name}`)}>
          <Image className="feedback-image" src={item.image} alt={`Attachment from ${item.name}`} width={560} height={360} unoptimized />
          <span><ZoomIn />Open larger</span>
        </button>
      ) : null}
    </article>
  );
}

export function FeedbackPage({ currentUser }: { currentUser: AuthUser }) {
  const adminView = currentUser.role === "admin";
  const resource = useResource(() => adminView ? api.adminFeedback() : api.feedback(), [adminView]);
  const [name, setName] = useState(currentUser.username);
  const [email, setEmail] = useState(currentUser.email);
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [processingImage, setProcessingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const chooseImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProcessingImage(true);
    try {
      setImage(await prepareImage(file, { maxWidth: 1280, maxHeight: 1280, maxDataUrlLength: 1_300_000 }));
      toast.success("Image ready", { description: "The attachment will be included with your feedback." });
    } catch (caught) {
      toast.error("Could not attach image", { description: caught instanceof Error ? caught.message : "Please choose another image." });
    } finally {
      setProcessingImage(false);
      if (imageInput.current) imageInput.current.value = "";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.createFeedback({ name, email, message, image });
      setMessage("");
      setImage(null);
      toast.success("Feedback sent", { description: "Thank you. Your message is now available to the Goal Planner administrators." });
      await resource.reload();
    } catch (caught) {
      toast.error("Could not send feedback", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  const items = resource.data ?? [];
  const selectedFeedback = items.find((item) => item.id === selectedFeedbackId) ?? null;

  return (
    <div className="page-shell feedback-page">
      <PageHeader
        eyebrow={adminView ? "Administrator inbox" : "Help shape Goal Planner"}
        title="Feedback"
        description={adminView ? "Review feedback and attachments submitted by every Goal Planner user." : "Share an idea, report an issue, or tell us what would make your planner more useful."}
      />

      {!adminView ? (
        <Panel className="feedback-form-panel" title="Send feedback">
          <form className="feedback-form" onSubmit={submit}>
            <div className="form-grid two-columns">
              <Field label="Name"><Input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></Field>
              <Field label="Email"><Input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
            </div>
            <Field label="Feedback" hint="Include enough detail for an administrator to understand the request.">
              <Textarea required minLength={3} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write your feedback here..." />
            </Field>
            <div className="feedback-upload-row">
              <input ref={imageInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseImage(event)} />
              <Button type="button" variant="outline" disabled={processingImage} onClick={() => imageInput.current?.click()}>
                {processingImage ? <LoaderCircle className="spin" /> : <ImagePlus />}{processingImage ? "Preparing image..." : image ? "Replace image" : "Attach image"}
              </Button>
              <span>Optional · JPEG, PNG, or WebP</span>
            </div>
            {image ? (
              <div className="feedback-image-preview">
                <Image src={image} alt="Feedback attachment preview" width={800} height={500} unoptimized />
                <button type="button" aria-label="Remove attachment" title="Remove attachment" onClick={() => setImage(null)}><X /></button>
              </div>
            ) : null}
            <Button className="neon-button feedback-submit" disabled={submitting || processingImage}>
              {submitting ? <LoaderCircle className="spin" /> : <Send />}{submitting ? "Sending..." : "Send feedback"}
            </Button>
          </form>
        </Panel>
      ) : null}

      <section className="feedback-history" aria-labelledby="feedback-history-title">
        <div className="feedback-history-heading">
          <div><p className="eyebrow">{adminView ? "All submissions" : "Your submissions"}</p><h2 id="feedback-history-title">{adminView ? "Feedback inbox" : "Previously sent feedback"}</h2></div>
          {resource.data ? <span><Inbox />{items.length} {items.length === 1 ? "message" : "messages"}</span> : null}
        </div>
        {resource.loading && !resource.data ? <LoadingState label="Loading feedback..." /> : null}
        {resource.error && !resource.data ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : null}
        {resource.data && items.length === 0 ? <EmptyState icon={<MessageSquareText />} title="No feedback yet" description={adminView ? "User submissions will appear here as soon as they arrive." : "Once you send feedback, you can review it here."} /> : null}
        {items.length > 0 ? (
          <div className="feedback-inbox">
            <aside className="feedback-list-pane" aria-label="Feedback messages">
              <header><span>Messages</span><strong>{items.length}</strong></header>
              <div className="feedback-list">
                {items.map((item) => <FeedbackListItem key={item.id} item={item} selected={item.id === selectedFeedbackId} onSelect={() => setSelectedFeedbackId(item.id)} />)}
              </div>
            </aside>
            <section className="feedback-reader" aria-live="polite">
              {selectedFeedback ? (
                <FeedbackReader item={selectedFeedback} adminView={adminView} onClose={() => setSelectedFeedbackId(null)} onZoom={(src, alt) => setZoomedImage({ src, alt })} />
              ) : (
                <div className="feedback-reader-empty"><MessageSquareText /><h3>Select feedback</h3><p>Choose a message from the list to read its details.</p></div>
              )}
            </section>
          </div>
        ) : null}
      </section>

      <Dialog open={Boolean(zoomedImage)} onOpenChange={(open) => !open && setZoomedImage(null)}>
        <DialogContent className="feedback-image-dialog">
          <DialogHeader>
            <DialogTitle>Feedback attachment</DialogTitle>
            <DialogDescription>Expanded image preview. Press Escape or use the close button to return.</DialogDescription>
          </DialogHeader>
          {zoomedImage ? <div className="feedback-image-zoom"><Image src={zoomedImage.src} alt={zoomedImage.alt} width={1280} height={1280} unoptimized /></div> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
