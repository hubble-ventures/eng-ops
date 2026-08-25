import { toast } from 'sonner'
import type { NotificationProvider } from '@refinedev/core'

/** Bridges Refine's notifications to sonner toasts. */
export const notificationProvider: NotificationProvider = {
  open: ({ key, message, description, type }) => {
    if (type === 'success') {
      toast.success(message, { id: key, description })
    } else if (type === 'error') {
      toast.error(message, { id: key, description })
    } else {
      toast(message, { id: key, description })
    }
  },
  close: (key) => {
    toast.dismiss(key)
  },
}
