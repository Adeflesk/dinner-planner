ALTER TABLE "recipes" ADD COLUMN "equipment" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "equipment" jsonb DEFAULT '[]'::jsonb NOT NULL;