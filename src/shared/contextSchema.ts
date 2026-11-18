import { z } from 'zod';

const material = z.strictObject({
  id: z.string().min(1).max(200), name: z.string().min(1).max(255),
  pages: z.array(z.strictObject({ page: z.int().positive(), text: z.string().max(30000) })).max(50),
}).refine(value => value.pages.reduce((total, page) => total + page.text.length, 0) <= 30000, 'Material exceeds 30,000 characters');
export const contextFields = {
  materials: z.array(material).max(3).refine(items => items.reduce((total, item) => total + item.pages.reduce((n, p) => n + p.text.length, 0), 0) <= 60000, 'Materials exceed 60,000 characters').optional(),
  outputLanguage: z.string().min(1).max(60).optional(),
  deletedNodes: z.array(z.strictObject({ id: z.string(), label: z.string(), summary: z.string() })).max(5000).optional(),
  deletedTaskIds: z.array(z.string()).max(5000).optional(),
  lockedTaskIds: z.array(z.string()).max(5000).optional(),
};


export type MeetingContext = z.infer<ReturnType<typeof z.strictObject<typeof contextFields>>>;
