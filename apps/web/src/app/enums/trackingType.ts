export enum TrackingType{
    // Compte classique : le solde est calculé à partir des transactions
    NORMAL,
    // Compte non suivi (ex : portefeuille) : on n'enregistre que les dépenses, pas les entrées,
    // donc le solde n'a pas de sens et n'est pas affiché. Sert surtout aux statistiques.
    NOT_TRACKED,
    // Compte qui génère automatiquement ses intérêts (logique pas encore implémentée)
    WITH_INTEREST
}
