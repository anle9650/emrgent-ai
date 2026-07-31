CREATE TABLE IF NOT EXISTS "OpenemrConnection" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"serverUrl" text NOT NULL,
	"clientId" text NOT NULL,
	"clientSecretEncrypted" text NOT NULL,
	"scope" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "OpenemrConnection" ADD CONSTRAINT "OpenemrConnection_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
