# Instructions pour agents IA - Sereo V7

## Projet
Sereo V7 est une application locale Node.js / Express pour gérer :
- imports Ximi
- stock
- ventes
- préparation
- mode livreur
- tournée avec carte Leaflet

## Commandes
Installer :
npm install

Lancer :
node server.js

URL locale :
http://localhost:3000

## Structure
- server.js : backend Express
- public/index.html : structure HTML principale
- public/js/app.js : logique frontend
- public/css/style.css : design
- data/db.json : base locale JSON
- imports/ : fichiers importés

## Règles importantes
- Ne pas supprimer les fonctionnalités existantes.
- Ne pas modifier les imports Ximi sans vérifier la logique range: 2.
- Ne pas envoyer node_modules dans Git.
- Garder l’application simple et locale.
- Priorité actuelle : stabiliser le Mode livreur.

## Objectif Mode livreur
Le mode livreur doit permettre :
- afficher la carte
- calculer une tournée
- afficher un client en cours
- bouton Livrée
- bouton Absent
- bouton Suivant
- enregistrer le statut client dans data/db.json
- fonctionner sur mobile