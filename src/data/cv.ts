export const navItems = [
	{ label: "Home", href: "#home-section" },
	{ label: "Profile", href: "#about-section" },
	{ label: "Experience", href: "#experience-section" },
	{ label: "Impact", href: "#impact-section" },
	{ label: "Toolkit", href: "#toolkit-section" },
	{ label: "Contact", href: "#contact-section" }
];

export const profile = {
	name: "Luke Harjulin",
	role: "Senior DevOps Engineer",
	location: "United Kingdom",
	intro:
		"I build cloud automation, deployment workflows, and platform tooling that help engineering teams ship reliably in regulated environments.",
	summary: [
		"Senior DevOps Engineer with 5.5 years' experience building cloud automation, CI/CD workflows, and platform tooling for large engineering teams.",
		"I have worked across AWS, Azure, Terraform, GitHub Actions, Azure DevOps, ServiceNow automation, and identity platform configuration, with a focus on reliable and traceable delivery.",
		"I am looking for a forward-thinking engineering environment where I can help teams adopt AI and agentic engineering practices to accelerate delivery, while keeping platform reliability, governance, and developer experience at the centre."
	],
	links: [
		{
			label: "GitHub",
			href: "https://github.com/LukeHarjulin",
			kind: "github"
		},
		{
			label: "LinkedIn",
			href: "https://www.linkedin.com/in/luke-harjulin-272314117/",
			kind: "linkedin"
		},
		{
			label: "Codewars",
			href: "https://www.codewars.com/users/LukeHarjulin",
			kind: "codewars"
		}
	],
	cv: {
		label: "Download CV",
		href: "/cv/Luke-Harjulin-CV.pdf",
		filename: "Luke-Harjulin-CV.pdf"
	}
};

export const metrics = [
	{ value: "5+ yrs", label: "DevOps and platform engineering experience" },
	{ value: "Cloud + IaC", label: "AWS, Azure, Terraform, and serverless automation" },
	{ value: "CI/CD + DevEx", label: "Reusable workflows, release tooling, and developer enablement" },
	{ value: "Governance", label: "ServiceNow change automation, audit-ready releases, and access controls" }
];

export const impactHighlights = [
	{
		title: "CI/CD Platform Engineering",
		description:
			"Designed and maintained reusable GitHub Actions workflows adopted across 50+ repositories, standardising delivery and reducing duplicated pipeline logic.",
		tags: ["GitHub Actions", "Reusable workflows", "Semantic versioning"]
	},
	{
		title: "Infrastructure as Code",
		description:
			"Built shared Terraform modules covering EC2, IAM, ECR, RDS, networking, and account-level AWS configuration for consistent cloud delivery.",
		tags: ["Terraform", "AWS", "Policy compliance"]
	},
	{
		title: "Environment Lifecycle Automation",
		description:
			"Contributed to a serverless lifecycle platform orchestrating 50+ non-production environments across 20 engineering teams.",
		tags: ["Lambda", "Step Functions", "Self-service tooling"]
	},
	{
		title: "Change Management Automation",
		description:
			"Built a GitHub Action to create and close ServiceNow change requests from CI/CD pipelines, improving traceability and audit readiness.",
		tags: ["ServiceNow", "Release governance", "Audit trails"]
	},
	{
		title: "Cloud Platform Delivery",
		description:
			"Delivered cross-account IAM roles, RDS upgrades, SQS/SNS policy improvements, blue/green deployment fixes, and environment-aware pipelines.",
		tags: ["AWS", "IAM", "Production releases"]
	},
	{
		title: "Identity & Access Automation",
		description:
			"Established GitOps-based CI/CD for identity platform configuration with sync, promote, rollback, versioning, and dry-run workflows.",
		tags: ["ForgeRock CIAM", "GitOps", "Rollback tooling"]
	}
];

export const skillGroups = [
	{
		title: "Cloud & Infrastructure",
		items: [
			"AWS",
			"Azure",
			"Terraform",
			"Serverless architecture",
			"IAM",
			"EC2",
			"ECR",
			"RDS",
			"SQS",
			"SNS",
			"Networking",
			"Multi-account environments"
		]
	},
	{
		title: "DevOps & CI/CD",
		items: [
			"GitHub Actions",
			"Azure DevOps",
			"Reusable workflows",
			"Release engineering",
			"Deployment automation",
			"Semantic versioning",
			"PR automation"
		]
	},
	{
		title: "Platform Engineering",
		items: [
			"Internal developer platforms",
			"Self-service tooling",
			"Environment lifecycle management",
			"AI adoption enablement",
			"Reusable infrastructure modules",
			"Operational automation"
		]
	},
	{
		title: "Automation & Scripting",
		items: [
			"PowerShell",
			"YAML",
			"Bash",
			"C#",
			"JavaScript",
			"TypeScript",
			"API integrations"
		]
	},
	{
		title: "Security, Governance & Change",
		items: [
			"ServiceNow automation",
			"Audit-friendly delivery",
			"Access management",
			"Production release controls",
			"Policy-compliant infrastructure"
		]
	},
	{
		title: "Application & Identity Tooling",
		items: [
			".NET build pipelines",
			"npm pipelines",
			"ForgeRock CIAM",
			"Configuration promotion",
			"Rollback tooling"
		]
	}
];

export const certifications = [
	{
		label: "Microsoft Certified: Azure Developer Associate",
		badge: "/certifications/microsoft-azure-developer-associate.svg",
		href: "https://learn.microsoft.com/en-us/users/lukeharjulin-8650/credentials/7c55db20141571e"
	},
	{
		label: "AWS Certified CloudOps Engineer - Associate",
		badge: "/certifications/aws-cloudops-engineer-associate.png",
		href: "https://www.credly.com/badges/0e03494d-0184-4ef9-a82a-f1e375ad4662"
	},
	{
		label: "GitHub Copilot",
		badge: "/certifications/github-copilot.svg",
		href: "https://learn.microsoft.com/en-gb/users/lukeharjulin-8650/credentials/a95f5846337c3832?ref=https%3A%2F%2Fwww.linkedin.com%2F"
	},
	{
		label: "GitHub Actions",
		badge: "/certifications/github-actions.png",
		href: "https://www.credly.com/badges/579671d3-093f-421b-af85-f08d0885ac70/linked_in_profile"
	},
	{
		label: "Microsoft Certified: Azure Fundamentals",
		badge: "/certifications/microsoft-azure-fundamentals.png",
		href: "https://www.credly.com/badges/6e4ab486-1b5a-4952-b8bd-56c64bbbd310?source=linked_in_profile"
	}
] as const;

export const experience = {
	company: "NTT DATA",
	role: "Senior DevOps Engineer",
	context: "Major UK travel organisation",
	summary:
		"Promoted from Junior Engineer to Senior DevOps Engineer while building platform engineering, release engineering, and DevOps tooling for large-scale engineering teams.",
	responsibilities: [
		"Designed reusable CI/CD workflows to standardise delivery across dozens of repositories.",
		"Developed Terraform modules and layered infrastructure patterns for AWS-based platforms.",
		"Automated environment provisioning, maintenance, and teardown across non-production estates.",
		"Integrated change management processes into deployment pipelines to reduce manual release work.",
		"Supported identity and access tooling through GitOps-based configuration management.",
		"Partnered with engineering teams to improve deployment reliability, operational visibility, and developer experience."
	]
};

export const education = {
	award: "BSc (Hons) Computer Science",
	year: "2020"
};
