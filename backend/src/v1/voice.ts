import { z } from "zod";

export const MIA_VOICE_NAMES = ["Aoede", "Kore", "Leda"] as const;
export const miaVoiceNameSchema = z.enum(MIA_VOICE_NAMES);
export type MiaVoiceName = z.infer<typeof miaVoiceNameSchema>;
