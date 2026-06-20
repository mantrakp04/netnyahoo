DROP TABLE IF EXISTS `bookmarks`;
--> statement-breakpoint
DROP TABLE IF EXISTS `history`;
--> statement-breakpoint
DROP TABLE IF EXISTS `tabs`;
--> statement-breakpoint
DROP TABLE IF EXISTS `tab_groups`;
--> statement-breakpoint
DROP TABLE IF EXISTS `spaces`;
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`favicon` text,
	`folder` text,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`favicon` text,
	`visited_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_visited_idx` ON `history` (`visited_at`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Space 1' NOT NULL,
	`color` text,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `spaces` (`id`, `name`, `order`) VALUES ('default', 'Space 1', 0);--> statement-breakpoint
CREATE TABLE `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`title` text DEFAULT 'New Tab' NOT NULL,
	`url` text DEFAULT 'about:blank' NOT NULL,
	`favicon` text,
	`group_id` text,
	`order` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_accessed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tabs_space_idx` ON `tabs` (`space_id`);--> statement-breakpoint
CREATE INDEX `tabs_group_idx` ON `tabs` (`group_id`);
