# Notifications de nouveaux produits

Les acheteurs qui autorisent les notifications s’abonnent au sujet Firebase
`ma_boutique_new_products`. Le serveur envoie une notification à ce sujet après
la publication réussie d’un produit. Les vendeurs ne s’y abonnent pas.

## Configuration du serveur

1. Dans Firebase Console, ouvre le projet `kassaapk`, puis **Paramètres du projet > Comptes de service**.
2. Crée une clé privée de compte de service. Ne l’ajoute jamais au dépôt Git ni à l’application Flutter.
3. Dans les variables d’environnement du service Render, définis :
   - `FIREBASE_PROJECT_ID=kassaapk`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` avec le contenu JSON complet de la clé privée.
   - `PUBLIC_BASE_URL` avec l’URL HTTPS publique du serveur, si cette valeur n’est pas déjà configurée.
4. Redéploie le serveur.

Le serveur journalise un avertissement et continue à publier les produits si la
clé Firebase n’est pas configurée. Les notifications ne seront envoyées qu’après
configuration du compte de service et redéploiement.

Sur Android, le système affiche l’icône Ma Boutique dans la notification. Quand
l’application est ouverte, une bannière dans l’application affiche également le
logo complet.
