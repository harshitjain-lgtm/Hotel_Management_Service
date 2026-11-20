import { toast as sonner } from "sonner";
import { describeError } from "./api";

export { Toaster } from "@/components/ui/sonner";

/** App-wide toast API (unchanged call sites), rendered by sonner. */
export const toast = {
  success: (title: string, description?: string) => sonner.success(title, { description, duration: 5000 }),
  info: (title: string, description?: string) => sonner.info(title, { description, duration: 5000 }),
  warning: (title: string, description?: string) => sonner.warning(title, { description, duration: 7000 }),
  error: (title: string, description?: string) => sonner.error(title, { description, duration: 8000 }),
  fromError: (err: unknown) => {
    const { title, description } = describeError(err);
    sonner.error(title, { description, duration: 8000 });
  },
};
