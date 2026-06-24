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
		"I build cloud automation, delivery tooling, and platform foundations that help engineering teams move faster with cleaner engineering practices.",
	summary: [
		"Senior DevOps Engineer with 5+ years building platform tooling, cloud automation, and delivery workflows across aviation and travel, utilities trading, and industrial cloud environments.",
		"I focus on automation-led delivery: pipeline templates, infrastructure modules, application scaffolding, cloud migration support, environment lifecycle workflows, and developer enablement.",
		"The common thread across my work is turning manual or repeated delivery problems into maintained platform capability that teams can adopt with less operational overhead."
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
		href: "/cv/Luke-Harjulin-CV-v1.pdf",
		filename: "Luke-Harjulin-CV-v1.pdf"
	}
};

export const metrics = [
	{ value: "5+ yrs", label: "DevOps and platform engineering experience" },
	{ value: "Cross-sector", label: "Aviation, travel, utilities trading, and industrial platforms" },
	{ value: "AWS + Azure", label: "Cloud infrastructure, application hosting, and IaC" },
	{ value: "Automation", label: "CI/CD workflows, templates, scripting, and deployment tooling" }
];

export const impactHighlights = [
	{
		title: "Cloud Migration Enablement",
		description:
			"Supported aviation and travel teams moving core applications from on-prem hosting toward AWS, while helping automate GitHub-based delivery practices.",
		tags: ["AWS", "GitHub", "Migration"]
	},
	{
		title: "Reusable CI/CD Platform",
		description:
			"Built central GitHub workflows and actions for Terraform, npm, .NET, SFTP, and AWS role management, reducing duplicated pipeline logic across teams.",
		tags: ["GitHub Actions", "TeamCity migration", "DevEx"]
	},
	{
		title: "Azure Platform Engineering",
		description:
			"Delivered infrastructure for React, .NET 6 API, and JMeter performance testing apps, integrating Azure Batch, Service Bus, Event Grid, CDN, Media Services, and private networking.",
		tags: ["Azure", ".NET 6", "Terraform"]
	},
	{
		title: "Delivery Starter Kits",
		description:
			"Created tooling to generate .NET APIs, Azure DevOps pipelines, Kubernetes manifests, and repository content, with frontend templates wired to API services.",
		tags: ["AKS", "PowerShell", "Templates"]
	},
	{
		title: "Infrastructure as Code",
		description:
			"Built Terraform modules and layered cloud patterns across AWS and Azure, improving repeatability for infrastructure changes and environment-aware delivery.",
		tags: ["Terraform", "Docker", "YAML"]
	},
	{
		title: "Governed Delivery Automation",
		description:
			"Automated ServiceNow change creation and closure from CI/CD, and supported GitOps identity workflows with promotion, rollback, and dry-run paths.",
		tags: ["ServiceNow", "GitOps", "Rollback"]
	}
];

export const skillGroups = [
	{
		title: "Cloud & Infrastructure",
		items: [
			"AWS",
			"Azure",
			"Terraform",
			"Kubernetes",
			"AKS",
			"Docker",
			"Networking",
			"IAM",
			"RDS",
			"SQS/SNS",
			"ECR",
			"Private networking"
		]
	},
	{
		title: "Azure Platform Services",
		items: [
			"Azure Batch",
			"Azure Service Bus",
			"Azure Event Grid",
			"Azure CDN",
			"Azure Media Services",
			"Azure Functions",
			"Azure Web Apps"
		]
	},
	{
		title: "DevOps & CI/CD",
		items: [
			"GitHub Actions",
			"Azure DevOps",
			"TeamCity",
			"Octopus Deploy",
			"Reusable workflows",
			"YAML pipelines",
			"Deployment automation",
			"Semantic versioning",
			"PR automation"
		]
	},
	{
		title: "Application Templates",
		items: [
			".NET 6",
			"C#",
			"React",
			"Angular",
			"JavaScript",
			"TypeScript",
			"Minimal APIs",
			"JMeter",
			"API scaffolding",
			"Frontend/API templates"
		]
	},
	{
		title: "Automation & Scripting",
		items: [
			"PowerShell",
			"YAML",
			"Bash",
			"Terraform modules",
			"Generator tooling",
			"Repository automation",
			"API integrations",
			"Operational automation"
		]
	},
	{
		title: "Governance & Tooling",
		items: [
			"ServiceNow automation",
			"GitHub Advanced Security",
			"SonarQube",
			"Artifactory",
			"Audit-friendly delivery",
			"Change controls",
			"Access management",
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
	context: "Client-facing platform engineering delivery",
	summary:
		"Progressed from Junior Engineer to Senior DevOps Engineer while delivering cloud, platform, automation, and release engineering work for client delivery teams.",
	responsibilities: [
		"Translate client delivery needs into automated platform patterns, pipelines, scripts, and infrastructure modules.",
		"Work across application, cloud, and release boundaries, combining hands-on implementation with guidance for engineering teams.",
		"Support adoption of shared delivery platforms through documentation, pairing, migration support, and practical troubleshooting.",
		"Improve delivery reliability and traceability through repeatable build, deploy, environment, and change-management workflows.",
		"Operate across AWS, Azure, CI/CD, infrastructure as code, scripting, and application scaffolding depending on the engagement."
	]
};

export const education = {
	award: "BSc (Hons) Computer Science",
	year: "2020"
};
