# Codes d’abonnement vendeur

Les codes sont créés par le serveur, stockés sous forme de hash dans Supabase et utilisables une seule fois pendant 30 jours.

## Mise en service

1. Dans le projet Supabase de Ma Boutique, ouvre **SQL Editor** et exécute le contenu de `subscription_codes.sql`. Le script crée la table de codes ainsi que la table des demandes de paiement.
2. Vérifie que `SUPABASE_URL` et `SUPABASE_SECRET_KEY` sont configurés dans l’environnement privé du serveur. Configure également `ADMIN_KEY` avec une longue clé secrète connue uniquement de l’administrateur.
3. Déploie la nouvelle version du serveur et reconstruis l’application Flutter.
4. Le vendeur effectue le transfert Orange Money, puis envoie son numéro et la référence de transaction depuis l’écran d’abonnement. La demande apparaît dans **Espace administrateur** pour vérification.
5. Après vérification, l’administrateur choisit SMS ou WhatsApp et valide la demande. Le serveur génère le code et l’application ouvre le composeur avec un message prérempli. L’administrateur doit appuyer sur **Envoyer**.
6. Le vendeur saisit le code dans **Abonnement vendeur**. Le serveur vérifie que le code existe et n’a pas encore été utilisé, puis l’active pour 30 jours.

Les codes existants qui étaient embarqués dans l’ancienne application ne sont pas repris par ce nouveau système. Les abonnements déjà activés sur un appareil restent enregistrés sur cet appareil jusqu’à leur expiration.
