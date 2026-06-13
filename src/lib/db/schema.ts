import {
  boolean, date, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import type { Ingredient, MacroSet } from '@/lib/macro/types';
import type { Portion } from '@/lib/macro/portions';
import type { ShoppingItem } from '@/lib/macro/aggregate';

export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  age: integer('age').notNull(),
  sex: text('sex', { enum: ['male', 'female'] }).notNull(),
  weightKg: real('weight_kg').notNull(),
  heightCm: real('height_cm').notNull(),
  activity: text('activity', { enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] }).notNull(),
  goal: text('goal', { enum: ['lose', 'maintain', 'gain'] }).notNull(),
  allergies: jsonb('allergies').$type<string[]>().notNull().default([]),
  dislikes: jsonb('dislikes').$type<string[]>().notNull().default([]),
});

export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  cuisine: text('cuisine').notNull().default('any'),
  method: text('method').notNull().default(''),
  servings: integer('servings').notNull().default(4),
  perServing: jsonb('per_serving').$type<MacroSet>().notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  source: text('source', { enum: ['family', 'ai'] }).notNull().default('family'),
  ingredients: jsonb('ingredients').$type<Ingredient[]>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const weekPlans = pgTable('week_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekStart: date('week_start').notNull().unique(), // Monday, YYYY-MM-DD
});

export const plannedDinners = pgTable('planned_dinners', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekPlanId: uuid('week_plan_id').notNull().references(() => weekPlans.id, { onDelete: 'cascade' }),
  day: integer('day').notNull(), // 0 = Monday … 6 = Sunday
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
  householdServings: real('household_servings').notNull(),
  portions: jsonb('portions').$type<Portion[]>().notNull(),
  pinned: boolean('pinned').notNull().default(false),
}, (t) => ({
  dayPerWeekIdx: uniqueIndex('planned_dinners_week_plan_id_day_idx').on(t.weekPlanId, t.day),
}));

export const pantryStaples = pgTable('pantry_staples', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

export type StoredShoppingItem = ShoppingItem & { checked: boolean; manual: boolean };

export const shoppingLists = pgTable('shopping_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekPlanId: uuid('week_plan_id').notNull().unique().references(() => weekPlans.id, { onDelete: 'cascade' }),
  items: jsonb('items').$type<StoredShoppingItem[]>().notNull().default([]),
});

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1), // singleton row
  dinnerShare: real('dinner_share').notNull().default(0.35),
  cuisines: jsonb('cuisines').$type<string[]>().notNull().default([]),
  vegetarianNights: integer('vegetarian_nights').notNull().default(0),
});
