# Assistant IA pour les descriptions produit

Le bouton avec l’icône étincelle, dans le champ **Description**, demande au serveur une proposition de texte en français à partir du nom et des détails du produit. Le vendeur peut modifier le texte avant de publier.

## Configuration Render

Dans les variables d’environnement du service Render, ajouter :

- `OPENAI_API_KEY` : une clé API créée dans le tableau de bord OpenAI Platform.
- `OPENAI_MODEL` : facultatif ; par défaut `gpt-6-astra`.

Ne place jamais la clé API dans Flutter, dans Git ou dans un fichier envoyé aux utilisateurs. L’application appelle le serveur Ma Boutique, et le serveur appelle l’API OpenAI avec cette clé.

Après avoir configuré les variables, redéployer le service `boutique_server`. Sans clé, l’assistant répondra qu’il n’est pas configuré ; les autres fonctions de publication restent disponibles.

La description générée est une suggestion : le vendeur doit la relire et la corriger si nécessaire avant de publier.
