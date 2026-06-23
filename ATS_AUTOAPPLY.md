# Auto-apply ATS

Petit suivi des ATS testés pour BLOW MY JOB Agent.

## OK testé

| ATS | Statut | Notes |
| --- | --- | --- |
| Lever | OK | Remplit les champs puis s'arrête avant `Submit application`. |
| Teamtailor | OK | Candidature = création de compte : email + mot de passe généré (stable par compte) + CV. N'est plus skippé. S'arrête avant `Postuler` final. |

## À tester

ATS déjà détectés par l'agent, mais pas encore validés proprement :

- LinkedIn Easy Apply
- Greenhouse
- Ashby
- Workable
- Welcome to the Jungle
- Recruitee
- SmartRecruiters
- Workday
- Taleo
- SuccessFactors
- Personio
- BambooHR
- Jobvite
- iCIMS
- Breezy
- Rippling ATS
- Join

## Règle de test

Un ATS passe en **OK** seulement si :

- le CV est uploadé quand le champ existe ;
- les champs identité/contact sont remplis ;
- les questions simples sont remplies ;
- l'agent s'arrête avant la soumission finale.
