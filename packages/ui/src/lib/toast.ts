import { createElement } from "react";
import { toast as sonner, type ExternalToast } from "sonner";
import { ToastTransitionIcon, ToastTransitionMessage } from "@dya/ui/components/toast-transition";

type Message = Parameters<typeof sonner>[0];
type Id = string | number;
const pending = new Map<Id, Message>();
let sequence = 0;
const renderMessage = (message: Message) => typeof message === "function" ? message() : message;

/** Supply the same operation-scoped ID (or the ID returned by loading) to update in place. */
export const toast = Object.assign((message: Message, options?: ExternalToast) => sonner(message, options), sonner, {
  loading(message: Message, options?: ExternalToast): Id {
    const id = options?.id ?? `dya-loading-${++sequence}`;
    pending.set(id, message);
    return sonner(createElement(ToastTransitionMessage, { current: renderMessage(message) }), {
      ...options, id, duration: Infinity, closeButton: false, dismissible: false,
      icon: createElement(ToastTransitionIcon, { complete: false }),
    });
  },
  success(message: Message, options?: ExternalToast): Id { return finish("success", message, options); },
  error(message: Message, options?: ExternalToast): Id { return finish("error", message, options); },
  dismiss(id?: Id) {
    if (id === undefined) pending.clear(); else pending.delete(id);
    return sonner.dismiss(id);
  },
});
function finish(outcome: "success" | "error", message: Message, options?: ExternalToast): Id {
  const id = options?.id;
  if (id === undefined || !pending.has(id)) return sonner[outcome](message, options);
  pending.delete(id);
  return sonner(createElement(ToastTransitionMessage, { current: renderMessage(message) }), {
    ...options, id, duration: options?.duration ?? 4000, dismissible: options?.dismissible ?? true,
    icon: createElement(ToastTransitionIcon, { complete: true, outcome }),
  });
}
