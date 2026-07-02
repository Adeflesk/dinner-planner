CREATE TABLE "pantry_staples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "pantry_staples_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"age" integer NOT NULL,
	"sex" text NOT NULL,
	"weight_kg" real NOT NULL,
	"height_cm" real NOT NULL,
	"activity" text NOT NULL,
	"goal" text NOT NULL,
	"allergies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dislikes" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_dinners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_plan_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"recipe_id" uuid NOT NULL,
	"household_servings" real NOT NULL,
	"portions" jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cuisine" text DEFAULT 'any' NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"servings" integer DEFAULT 4 NOT NULL,
	"per_serving" jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'family' NOT NULL,
	"ingredients" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"dinner_share" real DEFAULT 0.35 NOT NULL,
	"cuisines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vegetarian_nights" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_plan_id" uuid NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "shopping_lists_week_plan_id_unique" UNIQUE("week_plan_id")
);
--> statement-breakpoint
CREATE TABLE "week_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	CONSTRAINT "week_plans_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
ALTER TABLE "planned_dinners" ADD CONSTRAINT "planned_dinners_week_plan_id_week_plans_id_fk" FOREIGN KEY ("week_plan_id") REFERENCES "public"."week_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_dinners" ADD CONSTRAINT "planned_dinners_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_week_plan_id_week_plans_id_fk" FOREIGN KEY ("week_plan_id") REFERENCES "public"."week_plans"("id") ON DELETE cascade ON UPDATE no action;